import { z } from 'zod';
import { RunOutcome } from '../interfaces/runner.interface.js';

export const executeCommandSchema = z
  .object({
    name: z.string(),
  })
  .required();

export type ExecuteCommandDto = z.infer<typeof executeCommandSchema>;

// The optional HTTP header, or MQTT 5 user property, with which a client
// marks a request, so that the runner can recognise a repeat of it
export const REQUEST_KEY = 'idempotency-key';

export const requestKeySchema = z.string().max(255).optional();

export type ExecuteResponseDto = {
  status: 'success' | 'invalid command' | 'stopped';
};

const EXECUTE_STATUS: Record<RunOutcome, ExecuteResponseDto['status']> = {
  success: 'success',
  failed: 'invalid command',
  stopped: 'stopped',
};

export const executeResponse = (outcome: RunOutcome): ExecuteResponseDto => ({
  status: EXECUTE_STATUS[outcome],
});

// Without a name, or without a body, every run in progress stops
export const stopSchema = z.object({ name: z.string().optional() }).default({});

export type StopDto = z.infer<typeof stopSchema>;

export type StopResponseDto = { stopped: string[] };
