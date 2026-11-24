import { execFile } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from '@jest/globals';
import { reinstateTwin } from './reinstate.util';

const MAIN = 'dist/src/main.js';

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
    },
    30000,
  );
});
