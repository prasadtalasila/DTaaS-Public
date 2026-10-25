import { ExecuteCommandDto } from 'src/dto/command.dto.js';
import { RunOutcome } from './runner.interface.js';

// How a command ended, and its stdout and stderr logs
type CommandResult = [RunOutcome, Map<string, string>];

// A command in the queue, with its times in ISO 8601 UTC; finishedAt is
// null while it runs
type CommandRecord = {
  id: number;
  name: string;
  status: string;
  stdout: string;
  stderr: string;
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
};

interface Manager {
  newCommand(name: string, requestKey?: string): Promise<CommandResult>;
  checkHistory(): Array<ExecuteCommandDto>;
  checkStatus(): CommandStatus;
  stop(name?: string): Promise<string[]>;
}

export { CommandRecord, CommandResult, CommandStatus, Manager };
