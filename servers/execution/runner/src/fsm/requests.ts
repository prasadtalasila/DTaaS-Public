import { Logger } from '@nestjs/common';
import { fsmReply, FsmReplyDto } from '../dto/fsm.dto.js';
import RecentReplies from './recent-replies.js';
import StateMachine from './state-machine.js';

export type Handle = (machine: StateMachine) => FsmReplyDto;

// The machine of the service, if it has one, and whether shutdown began
export type Current = { machine: StateMachine | undefined; stopping: boolean };

// Answers the transition and event requests of the state machine
export default class Requests {
  private readonly replies = new RecentReplies<FsmReplyDto>();

  // eslint-disable-next-line no-useless-constructor
  constructor(private readonly current: () => Current) {} // eslint-disable-line no-empty-function

  // A repeated request key gets the reply to its first request, if that
  // was accepted; a refused request changed nothing, so it is checked
  // again
  reply(
    request: string,
    requestKey: string | undefined,
    handle: Handle,
  ): FsmReplyDto {
    return this.replies.resolve(requestKey, request, {
      compute: () => this.answer(handle),
      mismatch: () =>
        fsmReply('invalid request key', this.current().machine?.state),
      keep: ({ status }) => status === 'accepted',
    });
  }

  answer(handle: Handle): FsmReplyDto {
    const { machine, stopping } = this.current();
    if (machine === undefined) {
      return fsmReply('no state machine', undefined);
    }
    if (stopping) {
      return fsmReply('stopping', machine.state);
    }
    return handle(machine);
  }

  // Answers an event that a parameter raises: the reply goes nowhere, so
  // a refused event is logged, and it never escalates
  raise(event: string, handle: Handle, logger: Logger): void {
    logStay(logger, this.answer(handle), event);
  }
}

// Logs an event that left the machine where it was; an event without a
// transition is common, so it is logged at debug level
export function logStay(
  logger: Logger,
  { status, state }: FsmReplyDto,
  event: string,
): void {
  if (status !== 'accepted') {
    const level = status === 'no transition' ? 'debug' : 'warn';
    logger[level](`Stayed in state ${state} on ${event}: ${status}`);
  }
}
