import { join } from 'path';
import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import {
  CommandRecord,
  CommandResult,
  CommandStatus,
  Manager,
} from './interfaces/command.interface.js';
import Queue from './queue.service.js';
import { ExecuteCommandDto } from './dto/command.dto.js';
import { DatabaseMode } from './dto/health.dto.js';
import RunnerFactory from './runner-factory.service.js';
import Config from './config/configuration.service.js';
import Runner, { RunOutcome } from './interfaces/runner.interface.js';

// The outcome of a stored command; an unfinished one counts as failed
const OUTCOME: Record<string, RunOutcome> = {
  valid: 'success',
  stopped: 'stopped',
};

const storedResult = (command: CommandRecord): CommandResult => [
  OUTCOME[command.status] ?? 'failed',
  new Map([
    ['stdout', command.stdout],
    ['stderr', command.stderr],
  ]),
];

// A command run in progress, its row in the queue, and its runner; a
// command that is not permitted has no runner
type Run = { id: number; result: Promise<CommandResult>; runner?: Runner };

type StoppableRun = [string, Run & { runner: Runner }];

@Injectable()
export default class ExecaManager implements Manager, OnApplicationShutdown {
  private readonly logger = new Logger(ExecaManager.name);

  // the runs in progress, by command name
  private readonly running = new Map<string, Run>();

  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly commandQueue: Queue,
    private readonly config: Config,
  ) {} // eslint-disable-line no-empty-function

  // A repeated request is not run again; it gets the result of the
  // request it repeats
  async newCommand(name: string, key?: string): Promise<CommandResult> {
    // an empty key marks no request
    const requestKey = key === '' ? undefined : key;
    const earlier = this.earlierRequest(requestKey);
    if (earlier !== undefined) {
      return this.repeat(name, earlier);
    }
    const current = this.running.get(name);
    if (current === undefined) {
      return this.start(name, requestKey);
    }
    return this.join(name, current, requestKey);
  }

  private earlierRequest(requestKey?: string): CommandRecord | undefined {
    return requestKey === undefined
      ? undefined
      : this.commandQueue.findByKey(requestKey);
  }

  private join(
    name: string,
    current: Run,
    requestKey?: string,
  ): Promise<CommandResult> {
    // keep the key, so that a retry of this request is a repeat too
    if (requestKey !== undefined) {
      this.commandQueue.addKey(requestKey, current.id);
    }
    this.logger.log(
      `Joined a request for ${JSON.stringify(name)} to its running command`,
    );
    return current.result;
  }

  // The stored result, or the run in progress, of the request whose key
  // the new request repeats; a key of another command is refused
  private async repeat(
    name: string,
    earlier: CommandRecord,
  ): Promise<CommandResult> {
    if (earlier.name !== name) {
      this.logger.warn(
        `Refused ${JSON.stringify(name)}: its request key is of ${earlier.name}`,
      );
      return ['failed', new Map<string, string>()];
    }
    this.logger.log(`Discarded a repeated request for ${JSON.stringify(name)}`);
    const current = this.running.get(name);
    if (current?.id === earlier.id) {
      return current.result;
    }
    return storedResult(earlier);
  }

  private start(name: string, requestKey?: string): Promise<CommandResult> {
    const id = this.commandQueue.enqueue(name, requestKey);
    const runner = this.createRunner(name);
    const result = this.finish(name, this.execute(id, runner));
    this.running.set(name, { id, result, runner });
    return result;
  }

  private createRunner(name: string): Runner | undefined {
    if (!this.config.permitCommands().includes(name)) {
      return undefined;
    }
    return RunnerFactory.create(
      join(this.config.getLocation(), name),
      this.config.getStopGrace(),
    );
  }

  // The run leaves the running ones once its result is stored
  private async finish(
    name: string,
    execution: Promise<CommandResult>,
  ): Promise<CommandResult> {
    try {
      return await execution;
    } finally {
      this.running.delete(name);
    }
  }

  private async execute(id: number, runner?: Runner): Promise<CommandResult> {
    let result: CommandResult = ['failed', new Map<string, string>()];
    if (runner !== undefined) {
      result = [await runner.run(), runner.checkLogs()];
    }
    this.commandQueue.complete(id, result);
    return result;
  }

  // Stops the run of the named command, or every run, and resolves with
  // their names once they have finished, so that a new request for one
  // of them starts the command afresh
  async stop(name?: string): Promise<string[]> {
    const runs = this.stoppable(name);
    runs.forEach(([, { runner }]) => void runner.stop());
    await Promise.allSettled(runs.map(([, { result }]) => result));
    return runs.map(([command]) => command);
  }

  // The runs of the named command, or all of them, that have a runner
  private stoppable(name?: string): StoppableRun[] {
    return [...this.running].filter(
      (run): run is StoppableRun =>
        run[1].runner !== undefined && (name === undefined || name === run[0]),
    );
  }

  // Lets the runs in progress finish, as their results go to the
  // database, which closes after them
  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled(
      [...this.running.values()].map(({ result }) => result),
    );
    this.commandQueue.close();
  }

  isRunning(name: string): boolean {
    return this.running.has(name);
  }

  private static createStatus(name: string, status: string) {
    return {
      name,
      status,
      logs: {
        stdout: '',
        stderr: '',
      },
    };
  }

  checkStatus(): CommandStatus {
    const command = this.commandQueue.activeCommand();
    if (command === undefined) {
      return ExecaManager.createStatus('none', 'invalid');
    }
    return {
      name: command.name,
      status: command.status,
      logs: { stdout: command.stdout, stderr: command.stderr },
    };
  }

  checkHistory(): Array<ExecuteCommandDto> {
    return this.commandQueue.checkHistory();
  }

  databaseMode(): DatabaseMode {
    return this.commandQueue.mode();
  }
}
