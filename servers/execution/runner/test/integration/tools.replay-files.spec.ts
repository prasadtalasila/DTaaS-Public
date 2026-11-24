import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  endedPair,
  Pair,
  replayFile,
  tool,
  wardTwin,
} from 'test/e2e/replay.util';

const TIMEOUT = 60000;

const built = existsSync(resolve('dist/src/tools/replay.js'))
  ? describe
  : describe.skip;

// The script of ok is a shell script; Windows runs its PowerShell twin
const unix = process.platform === 'win32' ? it.skip : it;

// In a replay twin, ok writes a line beside itself and one into its
// working directory
const WRITES = `[ -z "$DT_REPLAY_OF" ] || {
  echo ok >> "$(dirname "$0")/beside.log"
  echo ok >> here.log
}
`;

// What the scripts of a replay twin write stays in its out
built('The files of a replay twin', () => {
  let dir: string;
  let pair: Pair;

  beforeAll(async () => {
    dir = wardTwin();
    appendFileSync(join(dir, 'scripts', 'ok'), WRITES);
    pair = await endedPair(dir);
  }, TIMEOUT);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const lines = (...path: string[]) =>
    readFileSync(join(dir, ...path), 'utf8')
      .trim()
      .split('\n');

  unix(
    'Should run a copy of the scripts in out, and leave the snapshot as it was',
    async () => {
      replayFile(dir, 'a.yaml', { ...pair, out: 'a', speed: 50 });
      replayFile(dir, 'b.yaml', { ...pair, out: 'b', speed: 50 });
      const first = await tool('replay', ['a.yaml'], dir);
      const second = await tool('replay', ['b.yaml'], dir);

      expect([first.code, second.code]).toEqual([0, 0]);
      expect(lines('a', 'scripts', 'beside.log')).toEqual(['ok']);
      expect(lines('b', 'scripts', 'beside.log')).toEqual(['ok']);
      expect(lines('a', 'here.log')).toEqual(['ok']);
      expect(lines('b', 'here.log')).toEqual(['ok']);
      expect(existsSync(join(dir, pair.start, 'scripts', 'beside.log'))).toBe(
        false,
      );
      expect(existsSync(join(dir, 'here.log'))).toBe(false);
    },
    TIMEOUT,
  );
});
