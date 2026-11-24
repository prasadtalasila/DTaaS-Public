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
]);

// Seconds that a caller refused during a save waits to try again
export const RETRY_AFTER = 1;

export const saving = () =>
  new ServiceUnavailableException({ status: 'saving' });

// Pauses the twin while a save runs: the routes that change it are
// refused, and the completions of its scripts are held until the save
// ends, then handled in the order that they came
export default class Pause {
  private gate: Promise<void> = Promise.resolve();

  private release: (() => void) | undefined;

  get saving(): boolean {
    return this.release !== undefined;
  }

  // Throws the 503 of a save that runs already
  begin(): void {
    if (this.saving) {
      throw saving();
    }
    this.gate = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  end(): void {
    this.release?.();
    this.release = undefined;
  }

  refuses(route: Route): boolean {
    return this.saving && CHANGING.has(route);
  }

  // The value once no save runs; the gate is read when the value comes
  async hold<T>(value: Promise<T>): Promise<T> {
    const result = await value;
    await this.gate;
    return result;
  }
}
