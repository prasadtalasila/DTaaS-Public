import { Definition } from './definition.js';

// The current state of a digital twin and the transitions out of it.
// Each entry into a state has a number, so that the completion of the
// script of an earlier entry can be told apart.
export default class StateMachine {
  private current: string | undefined;

  private entries = 0;

  // eslint-disable-next-line no-useless-constructor
  constructor(private readonly definition: Definition) {} // eslint-disable-line no-empty-function

  get state(): string | undefined {
    return this.current;
  }

  get entry(): number {
    return this.entries;
  }

  get events(): string[] {
    return [...this.definition.events].sort();
  }

  hasState(state: string): boolean {
    return this.definition.states.has(state);
  }

  hasEvent(event: string): boolean {
    return this.definition.events.has(event);
  }

  // The state that the event leads to from the current state
  next(event: string): string | undefined {
    if (this.current === undefined) {
      return undefined;
    }
    return this.definition.states.get(this.current)?.get(event);
  }

  enter(state: string): number {
    this.current = state;
    this.entries += 1;
    return this.entries;
  }
}
