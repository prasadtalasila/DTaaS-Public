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
import { EscalateBody, EscalateReplyDto } from '../dto/escalation.dto.js';
import { ParametersBody } from '../dto/parameters.dto.js';
import Changes, { ChangeListener } from '../notify/changes.js';
import { CompletionEvent, loadDefinition, Transition } from './definition.js';
import Escalations, { EscalationListener } from './escalation.js';
import Parameters from './parameters.js';
import Requests from './requests.js';
import { Env, RunnerContext } from './script-context.js';
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

  private readonly requests = new Requests(() => ({
    machine: this.machine,
    stopping: this.stopping,
  }));

  // Signals a new state, or a new status of its script
  private readonly changes = new Changes();

  // What the scripts learn about the runner and the digital twin
  private readonly context = new RunnerContext();

  private readonly escalations = new Escalations();

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
    this.context.load(this.config.getId(), definition, this.declared);
    this.escalations.declare(definition?.escalation);
  }

  // The address of the HTTP API for scripts; undefined leaves it unset
  setRunnerUrl(url: string | undefined): void {
    this.context.setUrl(url);
  }

  // The environment of a script of POST /: the machine as it is
  environment(command: string): Env {
    const machine = this.machine;
    return this.context.environment(command, machine?.state, machine?.entry);
  }

  // No transition or completion starts a script once shutdown begins,
  // as the database closes after the scripts that run
  beforeApplicationShutdown(): void {
    this.stopping = true;
  }

  onChange(listener: ChangeListener): void {
    this.changes.on(listener);
  }

  onEscalation(listener: EscalationListener): void {
    this.escalations.on(listener);
  }

  // Needs no state machine, so that a plain DT escalates too
  escalate(body: EscalateBody, requestKey?: string): EscalateReplyDto {
    return this.escalations.request(body, requestKey, this.machine);
  }

  check(): FsmStateDto | undefined {
    return this.machine?.describe(this.status);
  }

  parameters(): Parameters | undefined {
    return this.declared;
  }

  // Applies the whole body or none of it, signals the new values before
  // their events move the machine, and returns the problems of a refused
  // body; the notifier skips a document that did not change
  setParameters(body: ParametersBody): string[] {
    const result = this.declared?.apply(body, (changes) =>
      this.queue.setParameters(changes),
    );
    this.changes.emit();
    result?.events.forEach((event) => this.raise(event));
    return result?.problems ?? [];
  }

  // Moves an idle machine to any of its states
  transition(state: string, requestKey?: string): FsmReplyDto {
    return this.requests.reply(`transition ${state}`, requestKey, (machine) => {
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
    return this.requests.reply(`event ${event}`, requestKey, (machine) => {
      const reply = this.move(machine, event);
      if (reply.status === 'no transition') {
        this.escalations.noTransition(machine, event);
      }
      return reply;
    });
  }

  private follow(machine: StateMachine, next: Transition): FsmReplyDto {
    return next.stop
      ? this.enterStopping(machine, next.state)
      : this.enter(machine, next.state);
  }

  // A refused event is logged; an event a parameter raises never escalates
  private raise(event: string): void {
    const { status, state } = this.requests.answer((machine) =>
      this.move(machine, event),
    );
    if (status !== 'accepted') {
      const level = status === 'no transition' ? 'debug' : 'warn';
      this.logger[level](`Stayed in state ${state} on ${event}: ${status}`);
    }
  }

  private move(machine: StateMachine, event: string): FsmReplyDto {
    if (!machine.hasEvent(event)) {
      return fsmReply('invalid event', machine.state);
    }
    const next = machine.next(event);
    if (next === undefined) {
      return fsmReply('no transition', machine.state);
    }
    return this.follow(machine, next);
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
    // run enqueues the command synchronously, so the queue has already
    // signalled the full document and the notifier skips this one
    this.changes.emit();
    return fsmReply('accepted', state);
  }

  // Enters the state at once, making the stopped script's completion
  // stale, and runs the state's script once that script has exited; a
  // self-transition restarts the script.
  private enterStopping(machine: StateMachine, state: string): FsmReplyDto {
    const left = machine.state as string;
    if (state !== left && this.manager.isRunning(state)) {
      return fsmReply('script running', machine.state);
    }
    const entry = machine.enter(state);
    this.status = 'running';
    // manager.stop never rejects
    this.pendingStop = this.pendingStop.then(() => this.manager.stop(left));
    void this.pendingStop.then(() => this.run(machine, state, entry));
    this.changes.emit();
    return fsmReply('accepted', state);
  }

  private isCurrent(machine: StateMachine, entry: number): boolean {
    return !this.stopping && machine.entry === entry;
  }

  // Skipped after shutdown or a later entry (a stopped script may exit
  // late); otherwise it starts at once, so it runs before enter returns
  private async run(
    machine: StateMachine,
    state: string,
    entry: number,
  ): Promise<void> {
    if (!this.isCurrent(machine, entry)) {
      return;
    }
    const env = this.context.environment(state, state, entry);
    const script = { state, env };
    const outcome = await scriptOutcome(this.manager, script, this.logger);
    if (!this.isCurrent(machine, entry)) {
      return;
    }
    this.status = STATUS[outcome];
    this.changes.emit();
    this.complete(machine, COMPLETION[outcome]);
  }

  // No completion transition stops a script (the definition refuses
  // stop on them); a failure without a transition may escalate
  private complete(machine: StateMachine, event: CompletionEvent): void {
    const next = machine.next(event);
    if (next === undefined) {
      if (event === '$failure') {
        this.escalations.failure(machine);
      }
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
