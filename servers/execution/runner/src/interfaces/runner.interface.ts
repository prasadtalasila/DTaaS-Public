// How a run ended: stopped only when the runner stopped it
export type RunOutcome = 'success' | 'failed' | 'stopped';

// What a run passes to its script
export type RunOptions = { input?: string; env?: Record<string, string> };

export default interface Runner {
  run(options?: RunOptions): Promise<RunOutcome>;
  stop(): Promise<void>;
  checkLogs(): Map<string, string>;
}
