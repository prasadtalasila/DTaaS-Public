import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import {
  call,
  operator,
  Saved,
  savedTwin,
  stopRunner,
} from './replay-twin.util';
import { startStoredRunner } from './util';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

// A replay twin started by hand with the snapshot directory of the live twin
describe('The snapshot directory of a replay twin started by hand', () => {
  let saved: Saved;
  let replay: INestApplication;
  let copies: string;

  const replayAs = [operator, 'dt-1.replay'] as const;

  beforeAll(async () => {
    saved = await savedTwin();
    copies = join(saved.dir, 'snapshots', 'what-if', 'running');
    mkdirSync(copies, { recursive: true });
    replay = await startStoredRunner(
      join(saved.dir, 'replay.yaml'),
      saved.snapshot,
      1,
    );
  }, TIMEOUT);

  afterAll(async () => {
    await (replay && stopRunner(replay));
    rmSync(saved.dir, { recursive: true, force: true });
  });

  it('Should leave the what-if copies of the live twin', () => {
    expect(existsSync(copies)).toBe(true);
  });

  it('Should refuse a save, and write no snapshot', async () => {
    const before = readdirSync(join(saved.dir, 'snapshots')).sort();
    const save = await call(replay, replayAs, ['post', '/snapshot', {}]);

    expect(save.status).toBe(409);
    expect(save.body).toEqual({ status: 'no snapshot directory' });
    expect(readdirSync(join(saved.dir, 'snapshots')).sort()).toEqual(before);
  });
});
