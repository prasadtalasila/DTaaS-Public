import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import Config from '../config/configuration.service.js';
import ExecaManager from '../execa-manager.service.js';
import Queue from '../queue.service.js';
import {
  COMPLETION,
  fsmReply,
  FsmReplyDto,
  FsmStateDto,
  ScriptStatus,
  STATUS,
} from '../dto/fsm.dto.js';
import { ParametersBody } from '../dto/parameters.dto.js';
import { CompletionEvent, loadDefinition, Transition } from './definition.js';
import Parameters from './parameters.js';
import RecentReplies from './recent-replies.js';
import scriptOutcome from './script-outcome.js';
import StateMachine from './state-machine.js';

// Moves the digital twin between the states of its state machine, and
// runs the script of each state it enters. A transition request starts
// the machine; events and the completion of scripts move it on.
@Injectable()
export default class FsmService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(FsmService.name);

  private machine: StateMachine | undefined;

  private declared: Parameters | undefined;

  private status: ScriptStatus = 'none';

  private stopping = false;

  // The stops of stop transitions, in order, so that a later one does
  // not run its script while the script of an earlier one still exits
  private pendingStop: Promise<unknown> = Promise.resolve();

  private readonly replies = new RecentReplies<FsmReplyDto>();

  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly manager: ExecaManager,
    private readonly config: Config,
    private readonly queue: Queue,
  ) {} // eslint-disable-line no-empty-function

  load(): void {
    const definition = loadDefinition(
      this.config.getStateMachine(),
      this.config.permitCommands(),
    );
    this.machine = definition && new StateMachine(definition);
    this.declared = definition && new Parameters(definition.parameters);
  }

  // No transition or completion starts a script once shutdown begins,
  // as the database closes after the scripts that run
  beforeApplicationShutdown(): void {
    this.stopping = true;
  }

  hasMachine(): boolean {
    return this.machine !== undefined;
  }

  check(): FsmStateDto | undefined {
    if (this.machine === undefined) {
      return undefined;
    }
    return {
      state: this.machine.state ?? null,
      status: this.status,
      entry: this.machine.entry,
      events: this.machine.events,
    };
  }

  parameters(): Parameters | undefined {
    return this.declared;
  }

  // Applies the whole body or none of it, and returns the problems of a
  // refused one. Values are stored before they are committed, so that a
  // failing database changes neither; then their events are raised.
  setParameters(body: ParametersBody): string[] {
    const parameters = this.declared;
    if (parameters === undefined) {
      return [];
    }
    const result = parameters.check(body);
    if ('problems' in result) {
      return result.problems;
    }
    const { changes, events } = result;
    this.queue.setParameters(changes);
    parameters.commit(changes);
    events.forEach((event) => this.raise(event));
    return [];
  }

  // Moves an idle machine to any of its states
  transition(state: string, requestKey?: string): FsmReplyDto {
    return this.request(`transition ${state}`, requestKey, (machine) => {
      if (!machine.hasState(state)) {
        return fsmReply('invalid state', machine.state);
      }
      if (this.status === 'running') {
        return fsmReply('busy', machine.state);
      }
      return this.enter(machine, state);
    });
  }

  event(event: string, requestKey?: string): FsmReplyDto {
    return this.request(`event ${event}`, requestKey, (machine) => {
      if (!machine.hasEvent(event)) {
        return fsmReply('invalid event', machine.state);
      }
      const next = machine.next(event);
      if (next === undefined) {
        return fsmReply('no transition', machine.state);
      }
      return this.follow(machine, next);
    });
  }

  // The reply does not depend on the events, so a refused one is logged
  private raise(event: string): void {
    const { status, state } = this.event(event);
    if (status !== 'accepted') {
      const level = status === 'no transition' ? 'debug' : 'warn';
      this.logger[level](`Stayed in state ${state} on ${event}: ${status}`);
    }
  }

  private follow(
    machine: StateMachine,
    { state, stop }: Transition,
  ): FsmReplyDto {
    return stop
      ? this.enterStopping(machine, state)
      : this.enter(machine, state);
  }

  // A repeated request key gets the reply to its first request, if that
  // was accepted; a refused request changed nothing, so it is checked
  // again
  private request(
    request: string,
    requestKey: string | undefined,
    handle: (machine: StateMachine) => FsmReplyDto,
  ): FsmReplyDto {
    const earlier = this.replies.get(requestKey);
    if (earlier !== undefined) {
      return earlier.request === request
        ? earlier.reply
        : fsmReply('invalid request key', this.machine?.state);
    }
    const reply = this.reply(handle);
    if (reply.status === 'accepted') {
      this.replies.add(requestKey, request, reply);
    }
    return reply;
  }

  private reply(handle: (machine: StateMachine) => FsmReplyDto): FsmReplyDto {
    if (this.machine === undefined) {
      return fsmReply('no state machine', undefined);
    }
    if (this.stopping) {
      return fsmReply('stopping', this.machine.state);
    }
    return handle(this.machine);
  }

  // ExecaManager joins a run in progress, which would not run the
  // script for this entry, so a state with a running script is refused
  private enter(machine: StateMachine, state: string): FsmReplyDto {
    if (this.manager.isRunning(state)) {
      return fsmReply('script running', machine.state);
    }
    const entry = machine.enter(state);
    this.status = 'running';
    void this.run(machine, state, entry);
    return fsmReply('accepted', state);
  }

  // Enters the state at once, so that the completion of the script it
  // stops is stale, and runs the script of the state once the stopped
  // script of the state it left has exited. A self-transition restarts
  // the script.
  private enterStopping(machine: StateMachine, state: string): FsmReplyDto {
    const left = machine.state as string;
    if (state !== left && this.manager.isRunning(state)) {
      return fsmReply('script running', machine.state);
    }
    const entry = machine.enter(state);
    this.status = 'running';
    // manager.stop never rejects
    this.pendingStop = this.pendingStop.then(() => this.manager.stop(left));
    void this.pendingStop.then(() => this.runIfCurrent(machine, state, entry));
    return fsmReply('accepted', state);
  }

  // Shutdown, or a later entry, while the stopped script exited means
  // the script of this entry must not run
  private async runIfCurrent(
    machine: StateMachine,
    state: string,
    entry: number,
  ): Promise<void> {
    if (this.isCurrent(machine, entry)) {
      await this.run(machine, state, entry);
    }
  }

  private isCurrent(machine: StateMachine, entry: number): boolean {
    return !this.stopping && machine.entry === entry;
  }

  private async run(
    machine: StateMachine,
    state: string,
    entry: number,
  ): Promise<void> {
    const outcome = await scriptOutcome(this.manager, state, this.logger);
    if (!this.isCurrent(machine, entry)) {
      return;
    }
    this.status = STATUS[outcome];
    this.complete(machine, COMPLETION[outcome]);
  }

  // No completion transition stops a script, as the definition refuses
  // stop on completion events
  private complete(machine: StateMachine, event: CompletionEvent): void {
    const next = machine.next(event);
    if (next === undefined) {
      return;
    }
    const { status } = this.enter(machine, next.state);
    if (status !== 'accepted') {
      this.logger.warn(
        `Stayed in state ${machine.state} on ${event}: ${next.state} is ${status}`,
      );
    }
  }
}
