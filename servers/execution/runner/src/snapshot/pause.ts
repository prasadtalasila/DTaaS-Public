import { ServiceUnavailableException } from '@nestjs/common';
import type { Route } from '../auth/roles.js';

// The routes that change the twin, which a save refuses
const CHANGING: ReadonlySet<Route> = new Set<Route>([
  'transition',
  'event',
  'escalate',
  'execute',
  'stop',
  'set-parameters',
  'set-peers',
  'set-properties',
  'save',
  'whatif',
]);

// Seconds that a caller refused during a save waits to try again
export const RETRY_AFTER = 1;

// The refusal of a change during a save; SavingFilter adds Retry-After
export class SavingException extends ServiceUnavailableException {
  constructor() {
    super({ status: 'saving' });
  }
}

export const saving = () => new SavingException();

// What waits for a save to end: go lets it on; drop, for deferred work,
// tells that the runner shuts down instead
type Waiting = { go: () => void; drop?: () => void };

// Pauses the twin while a save runs: the routes that change it are
// refused, and the completions of its scripts and the events raised from
// within wait in one queue until the save ends, then go on in the order
// that they came. Once the runner shuts down after a save, none goes on.
export default class Pause {
  private active = false;

  private closing = false;

  private waiting: Waiting[] = [];

  get saving(): boolean {
    return this.active;
  }

  // Throws the 503 of a save that runs already
  begin(): void {
    if (this.active) {
      throw saving();
    }
    this.active = true;
  }

  end(): void {
    this.active = false;
    this.closing = false;
    this.waiting.splice(0).forEach(({ go }) => go());
  }

  // The runner shuts down after the save: the pause stays, nothing that
  // waits goes on, and the deferred work is dropped
  close(): void {
    this.closing = true;
    this.waiting.splice(0).forEach(({ drop }) => drop?.());
  }

  refuses(route: Route): boolean {
    return this.active && CHANGING.has(route);
  }

  // The value once no save runs; it waits if it comes during a save
  hold<T>(value: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      value.then((result) => this.queue({ go: () => resolve(result) }), reject);
    });
  }

  // Does the work now, or once the save ends, in turn with the held
  // completions; drop is called instead if the runner shuts down
  defer(work: () => void, drop: () => void): void {
    if (this.closing) {
      drop();
    } else if (this.active) {
      // a microtask, as a held completion goes on in one
      const go = () => void Promise.resolve().then(work);
      this.waiting.push({ go, drop });
    } else {
      work();
    }
  }

  private queue(waiting: Waiting): void {
    if (this.active) {
      this.waiting.push(waiting);
    } else {
      waiting.go();
    }
  }
}
