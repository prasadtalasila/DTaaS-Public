import {
  debugOnce,
  NO_RESOURCES,
  type ResourceWatch,
  type Sample,
  type ScriptResources,
} from './resources.js';

// Milliseconds between two samples
export const SAMPLE_MS = 500;

// Reads a process at once and then every interval, and keeps the last
// sample that succeeded. A read still pending when the timer fires skips
// that tick; the timer does not hold the process open.
export default class PollingWatch implements ResourceWatch {
  private latest: Sample | undefined;

  private reading = false;

  private readonly timer: NodeJS.Timeout;

  private readonly log = debugOnce();

  constructor(
    private readonly read: () => Promise<Sample>,
    intervalMs = SAMPLE_MS,
  ) {
    this.timer = setInterval(() => this.sample(), intervalMs);
    this.timer.unref();
    this.sample();
  }

  finish(): ScriptResources {
    clearInterval(this.timer);
    return this.latest ?? NO_RESOURCES;
  }

  private sample(): void {
    if (this.reading) {
      return;
    }
    this.reading = true;
    void this.read()
      .then(
        (sample) => {
          this.latest = sample;
        },
        (error: unknown) => this.log(`A resource read failed: ${error}`),
      )
      .finally(() => {
        this.reading = false;
      });
  }
}
