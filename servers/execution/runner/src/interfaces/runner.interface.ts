// How a run ended: stopped only when the runner stopped it
export type RunOutcome = 'success' | 'failed' | 'stopped';

export default interface Runner {
  run(): Promise<RunOutcome>;
  stop(): Promise<void>;
  checkLogs(): Map<string, string>;
}
