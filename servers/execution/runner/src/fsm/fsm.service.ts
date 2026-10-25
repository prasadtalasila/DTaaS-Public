import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import Config from '../config/configuration.service.js';
import ExecaManager from '../execa-manager.service.js';
import {
  fsmReply,
  FsmReplyDto,
  FsmStateDto,
  ScriptStatus,
} from '../dto/fsm.dto.js';
import { CompletionEvent, loadDefinition } from './definition.js';
import RecentReplies from './recent-replies.js';
import StateMachine from './state-machine.js';

// Moves the digital twin between the states of its state machine, and
// runs the script of each state it enters. A transition request starts
// the machine; events and the completion of scripts move it on.
@Injectable()
export default class FsmService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(FsmService.name);

  private machine: StateMachine | undefined;

  private status: ScriptStatus = 'none';

  private stopping = false;

  private readonly replies = new RecentReplies<FsmReplyDto>();

  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly manager: ExecaManager,
    private readonly config: Config,
  ) {} // eslint-disable-line no-empty-function

  load(): void {
    const definition = loadDefinition(
      this.config.getLocation(),
      this.config.permitCommands(),
    );
    this.machine = definition && new StateMachine(definition);
  }

  // No transition or completion starts a script once shutdown begins,
  // as the database closes after the scripts that run
  beforeApplicationShutdown(): void {
    this.stopping = true;
  }

  check(): FsmStateDto | undefined {
    if (this.machine === undefined) {
      return undefined;
    }
    return {
      state: this.machine.state ?? null,
      status: this.status,
      events: this.machine.events,
    };
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
      return this.enter(machine, next);
    });
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

  private async run(
    machine: StateMachine,
    state: string,
    entry: number,
  ): Promise<void> {
    const success = await this.succeeds(state);
    if (this.stopping || machine.entry !== entry) {
      return;
    }
    this.status = success ? 'valid' : 'invalid';
    this.complete(machine, success ? '$success' : '$failure');
  }

  // A script that could not start, as when the database is closed,
  // counts as failed
  private async succeeds(state: string): Promise<boolean> {
    try {
      const [success] = await this.manager.newCommand(state);
      return success;
    } catch (error) {
      this.logger.error(`Script of state ${state} did not run: ${error}`);
      return false;
    }
  }

  private complete(machine: StateMachine, event: CompletionEvent): void {
    const next = machine.next(event);
    if (next === undefined) {
      return;
    }
    const { status } = this.enter(machine, next);
    if (status !== 'accepted') {
      this.logger.warn(
        `Stayed in state ${machine.state} on ${event}: ${next} is ${status}`,
      );
    }
  }
}
