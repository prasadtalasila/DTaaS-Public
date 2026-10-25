import { execa, ResultPromise } from 'execa';
import Runner, {
  RunOptions,
  RunOutcome,
} from './interfaces/runner.interface.js';

export default class ExecaRunner implements Runner {
  command: string;

  args: string[];

  stdin: string = '';

  stdout: string = '';

  stderr: string = '';

  private subprocess: ResultPromise | undefined;

  // whether stop() reached the subprocess before it exited
  private stopped = false;

  // stopGrace: milliseconds between SIGTERM and SIGKILL on a stop;
  // execa's default of five seconds without it
  constructor(
    command: string,
    args: string[] = [],
    private readonly stopGrace?: number,
  ) {
    this.command = command;
    this.args = args;
  }

  // An env is the whole environment of the script, so execa does not
  // merge the runner's own into it
  async run(options?: RunOptions): Promise<RunOutcome> {
    try {
      const subprocess = execa(this.command, this.args, {
        forceKillAfterDelay: this.stopGrace,
        env: options?.env,
        extendEnv: options?.env === undefined,
      });
      this.subprocess = subprocess;
      const { stdout, stderr } = await subprocess;
      this.stderr = stderr;
      this.stdout = stdout;
      return this.outcome(true);
    } catch {
      return this.outcome(false);
    }
  }

  private outcome(success: boolean): RunOutcome {
    if (this.stopped) {
      return 'stopped';
    }
    return success ? 'success' : 'failed';
  }

  // Sends SIGTERM, and SIGKILL after the grace period, and resolves when
  // the subprocess has exited; a second call sends nothing more
  async stop(): Promise<void> {
    if (this.subprocess === undefined) {
      return;
    }
    this.stopped ||= this.subprocess.kill();
    await this.subprocess.catch(() => undefined);
  }

  checkLogs(): Map<string, string> {
    const logs: Map<string, string> = new Map<string, string>();

    logs.set('stdout', this.stdout);
    logs.set('stderr', this.stderr);

    return logs;
  }
}
