import { AsyncLocalStorage } from 'node:async_hooks';

// Who raised an event that no caller sent: a subscription to a peer, or
// a parameter whose change raises one
export type Internal = 'peer' | 'parameter';

// The principal and the seq that a request to a replay twin had in the
// twin; by is null for a row that no principal wrote there
export type Origin = { by: string | null; seq: number };

// The caller of the request in progress, as the access guard or the
// MQTT handler verified it, what raised an event from within, and the
// origin of a request to a replay twin
export type CallerContext = {
  by?: string;
  source?: Internal;
  peer?: string;
  origin?: Origin;
};

export const callerContext = new AsyncLocalStorage<CallerContext>();

export const currentCaller = (): CallerContext =>
  callerContext.getStore() ?? {};
