import type { HistoryEntryDto, HistoryQuery } from '../dto/history.dto.js';
import type { ScriptResources } from '../resources/resources.js';
import { RunOptions, RunOutcome } from './runner.interface.js';

// How a command ended, its stdout and stderr logs, its exit code, which
// is null when the script did not exit by itself with one, and the
// resources its script used
type CommandResult = [
  RunOutcome,
  Map<string, string>,
  number | null,
  ScriptResources,
];

// A command in the queue, with its times in ISO 8601 UTC; finishedAt is
// null while it runs
type CommandRecord = {
  id: number;
  name: string;
  status: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  resources: ScriptResources;
  finished: boolean;
  receivedAt: string;
  finishedAt: string | null;
};

// What a command request passes on: the options of its script, the
// caller that submitted it, which the queue stores, and listeners of
// the run in the history that the request was given, called at once
// unless refused, and of the end of a run, called before it is stored.
// mode marks a what-if run, or the save run that makes its copy.
type RunMode = 'what-if' | 'what-if-copy';

type CommandOptions = RunOptions & {
  by?: string;
  mode?: RunMode;
  onRun?: (id: number, stored?: boolean) => void;
  ended?: (outcome: RunOutcome, id: number) => void;
};

type CommandStatus = {
  name: string;
  status: string;
  logs: {
    stdout: string | undefined;
    stderr: string | undefined;
  };
  exitCode: number | null;
  resources: ScriptResources;
};

interface Manager {
  newCommand(
    name: string,
    requestKey?: string,
    options?: CommandOptions,
  ): Promise<CommandResult>;
  checkHistory(query?: HistoryQuery): HistoryEntryDto[];
  checkStatus(): CommandStatus;
  stop(name?: string): Promise<string[]>;
}

export {
  CommandOptions,
  CommandRecord,
  CommandResult,
  CommandStatus,
  Manager,
  RunMode,
};
