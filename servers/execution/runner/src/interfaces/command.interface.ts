import type { HistoryEntryDto, HistoryQuery } from '../dto/history.dto.js';
import { RunOptions, RunOutcome } from './runner.interface.js';

// How a command ended, its stdout and stderr logs, and its exit code,
// which is null when the script did not exit by itself with one
type CommandResult = [RunOutcome, Map<string, string>, number | null];

// A command in the queue, with its times in ISO 8601 UTC; finishedAt is
// null while it runs
type CommandRecord = {
  id: number;
  name: string;
  status: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  finished: boolean;
  receivedAt: string;
  finishedAt: string | null;
};

// What a command request passes on: the options of its script, and the
// caller that submitted it, which the queue stores
type CommandOptions = RunOptions & { by?: string };

type CommandStatus = {
  name: string;
  status: string;
  logs: {
    stdout: string | undefined;
    stderr: string | undefined;
  };
  exitCode: number | null;
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

export { CommandOptions, CommandRecord, CommandResult, CommandStatus, Manager };
