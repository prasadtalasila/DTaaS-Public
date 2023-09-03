import { Phase } from './lifecycle';

export default class Queue {
  private queue: Array<Phase>;

  constructor() {
    this.queue = new Array<Phase>();
  }

  enqueue(phase: Phase): boolean {
    this.queue.push(phase);
    return true;
  }

  phaseHistory(): Array<string> {
    return this.queue.map((phase) => phase.name);
  }

  activePhase(): Phase | undefined {
    return this.queue.at(this.queue.length - 1);
  }
}
