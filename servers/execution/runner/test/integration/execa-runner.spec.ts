import { resolve } from 'node:path';
import { describe, it, expect, jest } from '@jest/globals';
import Runner, { RunOutcome } from 'src/interfaces/runner.interface';
import ExecaRunner from 'src/execa-runner';
import RunnerFactory from 'src/runner-factory.service';
import { nonExistingCommand } from 'test/utils';

// The stop tests run scripts, and PowerShell takes a second or more to
// start on a loaded Windows host
jest.setTimeout(30000);

// Windows ends powershell.exe at once, so SIGTERM handling is POSIX only
const itOnPosix = process.platform === 'win32' ? it.skip : it;

const delay = (ms: number) =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

// A test script of the script folder that runs until it is stopped
const looping = (script: string, stopGrace?: number) =>
  RunnerFactory.create(resolve('script', script), stopGrace) as ExecaRunner;

describe('check command Runner based on execa library', () => {
  it('should execute a valid command', async () => {
    const cmdrunner: Runner = new ExecaRunner(process.execPath, ['--version']);

    expect(await cmdrunner.run()).toBe('success');
  });

  it('should attempt but not succeed in execution of an invalid command', async () => {
    const cmdrunner: Runner = new ExecaRunner(nonExistingCommand);
    const status: RunOutcome = await cmdrunner.run();

    expect(status).toBe('failed');
  });

  it('should capture single line output log', async () => {
    const cmdrunner: Runner = new ExecaRunner(process.execPath, ['--version']);

    const status: RunOutcome = await cmdrunner.run();
    const logs: Map<string, string> = cmdrunner.checkLogs();

    expect(status).toBe('success');
    expect(logs.get('stdout')).toEqual(expect.any(String));
    expect(logs.get('stderr')).toEqual('');
  });

  describe('stop', () => {
    it('should end a looping script as stopped', async () => {
      const runner = looping('loop');
      const run = runner.run();

      await runner.stop();

      expect(await run).toBe('stopped');
    });

    it('should stop only once when asked twice', async () => {
      const runner = looping('loop');
      const run = runner.run();

      await Promise.all([runner.stop(), runner.stop()]);

      expect(await run).toBe('stopped');
    });

    it('should do nothing before the script runs or after it ended', async () => {
      const runner = new ExecaRunner(process.execPath, ['--version']);
      await runner.stop();

      expect(await runner.run()).toBe('success');
      await runner.stop();
    });

    it('should count a script killed from outside as failed', async () => {
      const runner = looping('loop');
      const run = runner.run();

      process.kill(runner['subprocess']?.pid as number);

      expect(await run).toBe('failed');
    });

    itOnPosix(
      'should kill a script that ignores SIGTERM after the grace period',
      async () => {
        const runner = looping('ignore-term', 500);
        const run = runner.run();
        // let the shell set its trap before the stop
        await delay(300);

        const started = Date.now();
        await runner.stop();

        expect(Date.now() - started).toBeGreaterThanOrEqual(450);
        expect(await run).toBe('stopped');
      },
    );
  });
});
