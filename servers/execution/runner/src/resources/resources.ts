import { Logger } from '@nestjs/common';

// What a script run used: user plus system CPU time in seconds, rounded
// to the millisecond, and peak resident memory in bytes; null when not
// measured
export type ScriptResources = {
  readonly cpuSeconds: number | null;
  readonly peakRssBytes: number | null;
};

export const NO_RESOURCES: ScriptResources = Object.freeze({
  cpuSeconds: null,
  peakRssBytes: null,
});

// One successful read of a running process: its CPU time so far and its
// peak memory so far, which a platform may not know
export type Sample = { cpuSeconds: number; peakRssBytes: number | null };

// Watches one run from its start; finish gives the latest sample and
// stops watching without waiting for anything
export interface ResourceWatch {
  finish(): ScriptResources;
}

// Starts a watch on the process of a run, from its pid, undefined when
// the process did not start, and the time just after the spawn, in
// milliseconds since the epoch
export type Meter = (pid: number | undefined, start: number) => ResourceWatch;

export const NO_WATCH: ResourceWatch = { finish: () => NO_RESOURCES };

// Rounds seconds to the millisecond
export const roundSeconds = (seconds: number): number =>
  Math.round(seconds * 1000) / 1000;

const logger = new Logger('Resources');

// Logs at debug level the first message of a run only, as a failing
// read would fail again at every sample
export function debugOnce(): (message: string) => void {
  let logged = false;
  return (message) => {
    if (!logged) {
      logged = true;
      logger.debug(message);
    }
  };
}
