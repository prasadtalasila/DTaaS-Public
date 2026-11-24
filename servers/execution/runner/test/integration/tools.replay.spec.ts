import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { readRows } from 'src/tools/inputs';
import { replay } from 'src/tools/replay-run';
import { Pair, replayFile, runningPair, wardTwin } from 'test/e2e/replay.util';

const TIMEOUT = 60000;

// The built runner, which the tool starts as its child
const MAIN = resolve('dist/src/main.js');

const built = existsSync(MAIN) ? describe : describe.skip;

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
});
