import { ExecuteCommandDto } from 'src/dto/command.dto.js';
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
    options?: RunOptions,
  ): Promise<CommandResult>;
  checkHistory(): Array<ExecuteCommandDto>;
  checkStatus(): CommandStatus;
  stop(name?: string): Promise<string[]>;
}

export { CommandRecord, CommandResult, CommandStatus, Manager };
