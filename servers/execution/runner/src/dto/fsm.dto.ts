import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

export const transitionSchema = z.object({ state: z.string() }).required();

export type TransitionDto = z.infer<typeof transitionSchema>;

export const eventSchema = z.object({ event: z.string() }).required();

export type EventDto = z.infer<typeof eventSchema>;

// The outcome of a transition or event request, and its HTTP status;
// MQTT has no status codes, so the body names the outcome
export const FSM_STATUS_CODES = {
  accepted: HttpStatus.ACCEPTED,
  'invalid state': HttpStatus.BAD_REQUEST,
  'invalid event': HttpStatus.BAD_REQUEST,
  'invalid request key': HttpStatus.BAD_REQUEST,
  busy: HttpStatus.CONFLICT,
  'no transition': HttpStatus.CONFLICT,
  'script running': HttpStatus.CONFLICT,
  'no state machine': HttpStatus.NOT_FOUND,
  stopping: HttpStatus.SERVICE_UNAVAILABLE,
} as const;

export type FsmStatus = keyof typeof FSM_STATUS_CODES;

// The state after the request; null before the first transition
export type FsmReplyDto = {
  status: FsmStatus;
  state: string | null;
};

export const fsmReply = (
  status: FsmStatus,
  state: string | undefined,
): FsmReplyDto => ({ status, state: state ?? null });

export type ScriptStatus = 'none' | 'running' | 'valid' | 'invalid' | 'stopped';

// entry counts the entries into states, so that two entries into the
// same state can be told apart; it is 0 before the first transition
export type FsmStateDto = {
  state: string | null;
  status: ScriptStatus;
  entry: number;
  events: string[];
};
