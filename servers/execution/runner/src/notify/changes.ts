export type ChangeListener = () => void;

// Tells its listeners that the state document may have changed
export default class Changes {
  private readonly listeners: ChangeListener[] = [];

  on(listener: ChangeListener): void {
    this.listeners.push(listener);
  }

  emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
