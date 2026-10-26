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

  private exitCode: number | null = null;

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

  // A failure is an outcome, not an exception; stdin is closed after
  // the input, or at once without one, so a script that reads it ends.
  // An env is the whole environment of the script, so execa does not
  // merge the runner's own into it.
  async run(options?: RunOptions): Promise<RunOutcome> {
    const subprocess = execa(this.command, this.args, {
      forceKillAfterDelay: this.stopGrace,
      env: options?.env,
      extendEnv: options?.env === undefined,
      input: options?.input ?? '',
      reject: false,
    });
    this.subprocess = subprocess;
    const { stdout, stderr, exitCode, failed } = await subprocess;
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = this.stopped ? null : (exitCode ?? null);
    return this.outcome(!failed);
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
    // with reject: false, the subprocess resolves whatever its end
    await this.subprocess;
  }

  checkLogs(): Map<string, string> {
    const logs: Map<string, string> = new Map<string, string>();

    logs.set('stdout', this.stdout);
    logs.set('stderr', this.stderr);

    return logs;
  }

  checkExitCode(): number | null {
    return this.exitCode;
  }
}
