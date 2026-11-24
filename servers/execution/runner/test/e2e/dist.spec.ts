import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from '@jest/globals';
import { reinstateTwin } from './reinstate.util';

const MAIN = 'dist/src/main.js';

// A line of a stack trace
const STACK = /\n\s+at /;

const run = (args: string[]) =>
  promisify(execFile)(process.execPath, [MAIN, ...args]);

// ts-jest resolves imports that Node's ES module loader refuses, such as
// a relative import without its .js suffix, so start the build itself.
// Node links every module before main runs, so the help output proves
// that the whole build loads. CI builds before it tests.
describe('Built runner', () => {
  const built = existsSync(MAIN) ? it : it.skip;

  built(
    'Should load every module of the build',
    async () => {
      const { stdout } = await run(['-h']);

      expect(stdout).toContain('Usage: runner');
      expect(stdout).toContain('--reinstate <directory>');
    },
    30000,
  );

  // A refusal ends the process before it serves, so no port is taken
  built(
    'Should refuse to reinstate from a directory without a manifest',
    async () => {
      const dir = reinstateTwin();
      const snapshot = join(dir, 'none');
      const failed = await run([
        '-c',
        join(dir, 'runner.yaml'),
        '--reinstate',
        snapshot,
      ]).catch((error: { code: number; stderr: string }) => error);
      rmSync(dir, { recursive: true, force: true });

      expect(failed).toMatchObject({ code: 1 });
      expect((failed as { stderr: string }).stderr).toContain(
        `Can not reinstate from ${join(snapshot, 'snapshot.json')}: there is no manifest of a snapshot`,
      );
      expect((failed as { stderr: string }).stderr).not.toMatch(STACK);
    },
    30000,
  );

  // A refusal of the configuration prints its message as a refusal of a
  // reinstate does
  built(
    'Should refuse a missing configuration file without a stack trace',
    async () => {
      const failed = await run(['-c', 'none.yaml']).catch(
        (error: { code: number; stderr: string }) => error,
      );

      expect(failed).toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          'Invalid configuration: ENOENT: no such file or directory',
        ),
      });
      expect((failed as { stderr: string }).stderr).not.toMatch(STACK);
    },
    30000,
  );

  // npm install -g puts each command of bin on the path
  built(
    'Should install the runner and its two tools',
    async () => {
      const { bin } = JSON.parse(readFileSync('package.json', 'utf8'));
      const helps = await Promise.all(
        Object.values(bin as Record<string, string>).map((file) =>
          promisify(execFile)(process.execPath, [file, '--help']),
        ),
      );

      expect(Object.keys(bin)).toEqual([
        'runner',
        'runner-replay',
        'runner-compare',
      ]);
      expect(Object.values(bin).every((file) => existsSync(String(file)))).toBe(
        true,
      );
      expect(helps.map(({ stdout }) => stdout.split('\n')[0])).toEqual([
        'Usage: runner [options]',
        'Usage: runner-replay [options] [file]',
        'Usage: runner-compare [options] <a> <b>',
      ]);
    },
    30000,
  );
});
