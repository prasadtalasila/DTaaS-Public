import { CommandRefused } from './dto/command.dto.js';
import {
  CommandRecord,
  CommandResult,
  CommandStatus,
  RunMode,
} from './interfaces/command.interface.js';
import { RunOptions, RunOutcome } from './interfaces/runner.interface.js';
import { NO_RESOURCES } from './resources/resources.js';

// The outcome of a stored command; an unfinished or interrupted one
// counts as failed
const OUTCOME: Record<string, RunOutcome> = {
  valid: 'success',
  stopped: 'stopped',
};

// A finished command that was not permitted is refused again
export function storedResult(command: CommandRecord): CommandResult {
  if (command.finished && command.status === 'invalid') {
    throw new CommandRefused('invalid command');
  }
  return [
    OUTCOME[command.status] ?? 'failed',
    new Map([
      ['stdout', command.stdout],
      ['stderr', command.stderr],
    ]),
    command.exitCode,
    command.resources,
  ];
}

// A live request does not join a what-if, nor a what-if a live run, so
// that neither takes the output of the other
export function refuseOtherMode(running?: RunMode, asked?: RunMode): void {
  if (running !== asked) {
    throw new CommandRefused(
      running === 'what-if' ? 'what-if running' : 'command running',
    );
  }
}

// Joining a run would drop the input of the request
export function refuseInput(options?: RunOptions): void {
  if (options?.input !== undefined) {
    throw new CommandRefused('command running');
  }
}

// The latest command, as GET / answers it; none before the first
export function commandStatus(command?: CommandRecord): CommandStatus {
  if (command === undefined) {
    const logs = { stdout: '', stderr: '' };
    return {
      name: 'none',
      status: 'invalid',
      logs,
      exitCode: null,
      resources: NO_RESOURCES,
    };
  }
  return {
    name: command.name,
    status: command.status,
    logs: { stdout: command.stdout, stderr: command.stderr },
    exitCode: command.exitCode,
    resources: command.resources,
  };
}
