import { AsyncLocalStorage } from 'node:async_hooks';

// Who raised an event that no caller sent: a subscription to a peer, or
// a parameter whose change raises one
export type Internal = 'peer' | 'parameter';

// The caller of the request in progress, as the access guard or the
// MQTT handler verified it, and what raised an event from within
export type CallerContext = { by?: string; source?: Internal; peer?: string };

export const callerContext = new AsyncLocalStorage<CallerContext>();

export const currentCaller = (): CallerContext =>
  callerContext.getStore() ?? {};
