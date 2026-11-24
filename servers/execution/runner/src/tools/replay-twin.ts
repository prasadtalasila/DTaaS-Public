import { ChildProcess, spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep } from './times.js';
import { ToolError } from './tool-error.js';

// main.js of this package, beside the directory of the tools
export const MAIN = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'main.js',
);

const LOG = 'runner.log';

// The last lines of the log, for a runner that did not come up
function tail(file: string, lines = 20): string {
  const text = readFileSync(file, 'utf8').trimEnd();
  return text.split('\n').slice(-lines).join('\n');
}

// The runner of a replay twin, a child process of the tool, with its
// output in runner.log of out
export default class ReplayTwin {
  private child?: ChildProcess;

  private exited = false;

  constructor(
    private readonly out: string,
    readonly port: number,
    private readonly main = MAIN,
  ) {}

  start(snapshot: string, speed: number): void {
    const log = openSync(join(this.out, LOG), 'a');
    const config = join(this.out, 'runner.yaml');
    const args = ['-c', config, '--reinstate', snapshot, '--what-if'];
    this.child = spawn(
      process.execPath,
      [this.main, ...args, '--time-scale', String(speed)],
      { stdio: ['ignore', log, log] },
    );
    closeSync(log);
    this.child.once('exit', () => {
      this.exited = true;
    });
  }

  url(path: string): string {
    return `http://127.0.0.1:${this.port}${path}`;
  }

  private async healthy(): Promise<boolean> {
    const reply = await fetch(this.url('/health')).catch(() => undefined);
    return reply?.ok ?? false;
  }

  // Waits for GET /health, for the time given at most
  async ready(timeout = 30000): Promise<void> {
    const deadline = Date.now() + timeout;
    const up = async (): Promise<boolean> => {
      const ok = await this.healthy();
      if (ok || this.exited || Date.now() > deadline) {
        return ok;
      }
      await sleep(100);
      return up();
    };
    if (!(await up())) {
      const lines = tail(join(this.out, LOG));
      throw new ToolError(`The replay twin did not come up:\n${lines}`, 1);
    }
  }

  // Stops the runner as a signal does, and waits for it to end
  async stop(): Promise<void> {
    const child = this.child;
    if (child === undefined || this.exited) {
      return;
    }
    const ended = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    await ended;
    clearTimeout(timer);
  }

  // Ends the runner at once, as the tool ends
  kill(): void {
    if (!this.exited) {
      this.child?.kill('SIGKILL');
    }
  }
}
