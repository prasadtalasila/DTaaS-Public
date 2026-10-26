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
}
