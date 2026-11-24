import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { readRows } from 'src/tools/inputs';
import { replay } from 'src/tools/replay-run';
import { Pair, replayFile, runningPair, wardTwin } from 'test/e2e/replay.util';

const TIMEOUT = 60000;

// The built runner, which the tool starts as its child
const MAIN = resolve('dist/src/main.js');

const built = existsSync(MAIN) ? describe : describe.skip;

// pgrep is there on Linux and macOS
const unix = process.platform === 'win32' ? it.skip : it;

// Whether a process whose command line holds the text runs
const runs = (text: string): Promise<boolean> =>
  promisify(execFile)('pgrep', ['-f', text]).then(
    () => true,
    () => false,
  );

const until = async (
  check: () => Promise<boolean>,
  left = 300,
): Promise<void> => {
  if (left === 0 || (await check())) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  return until(check, left - 1);
};

// runner-replay in this process, so that its steps are measured
built('A replay in the process of the test', () => {
  let dir: string;
  let pair: Pair;

  beforeAll(async () => {
    dir = wardTwin();
    pair = await runningPair(dir);
    // the script of work now waits for go to the end of the replay
    rmSync(join(dir, 'go'));
  }, TIMEOUT);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it(
    'Should stop a replay twin that is not idle after settle, and say so',
    async () => {
      const file = replayFile(dir, 'busy.yaml', {
        ...pair,
        out: 'busy',
        speed: 50,
        settle: 0.3,
      });
      const out = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const err = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
      const code = await replay(file, false, MAIN);
      const said = [out, err].map((spy) =>
        spy.mock.calls.map(([text]) => String(text)).join(''),
      );
      out.mockRestore();
      err.mockRestore();
      const done = JSON.parse(
        readFileSync(join(dir, 'busy', 'replay.json'), 'utf8'),
      );

      expect(code).toBe(0);
      expect(said[0]).toContain('Sent 0 inputs, 0 refused');
      expect(said[1]).toContain('still ran a script after 0.3 s: stopped');
      expect(done).toMatchObject({ sent: 0, firstStep: expect.any(Number) });
      expect(readFileSync(join(dir, 'busy', 'runner.log'), 'utf8')).toContain(
        'A replay twin of dt-1',
      );
      expect(process.listenerCount('SIGINT')).toBe(0);
      // only the account of the tool reads out; Windows has no such mode
      const mode =
        process.platform === 'win32'
          ? 0o700
          : statSync(join(dir, 'busy')).mode & 0o777;
      expect(mode).toBe(0o700);
      expect(
        readRows(join(dir, 'busy', 'state.db'), done.from.seq)
          .filter(({ kind }) => kind === 'stop' || kind === 'exit')
          .map(({ kind, data }) => [kind, data.status]),
      ).toEqual([
        ['stop', undefined],
        ['exit', 'stopped'],
      ]);
    },
    TIMEOUT,
  );

  // process.exit is replaced, so that the handler runs in this process
  unix(
    'Should leave no runner and no script behind when the tool gets a signal',
    async () => {
      const file = replayFile(dir, 'signal.yaml', {
        ...pair,
        out: 'signal',
        speed: 50,
      });
      const script = join(dir, 'signal', 'scripts', 'work');
      const runner = join(dir, 'signal', 'runner.yaml');
      const exit = jest
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never);
      const quiet = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const ended = replay(file, false, MAIN).catch(() => 'ended');
      await until(() => runs(script));
      const started = await runs(script);
      process.emit('SIGTERM');
      await until(async () => exit.mock.calls.length > 0);
      const codes = exit.mock.calls.map(([code]) => code);
      exit.mockRestore();
      quiet.mockRestore();
      const left = [await runs(script), await runs(runner)];

      expect(started).toBe(true);
      expect(codes).toEqual([143]);
      expect(left).toEqual([false, false]);
      expect(await ended).toBeDefined();
    },
    TIMEOUT,
  );
});
