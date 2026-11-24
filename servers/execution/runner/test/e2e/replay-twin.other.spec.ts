import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import {
  call,
  client,
  operator,
  rowsSince,
  Saved,
  savedTwin,
  stopRunner,
} from './replay-twin.util';
import { startStoredRunner } from './util';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

// A runner reinstated from the same snapshot, without --what-if
describe('A runner that is no replay twin end-to-end', () => {
  let saved: Saved;
  let live: INestApplication;

  const liveAs = (caller = operator) => [caller, 'dt-1.live'] as const;

  beforeAll(async () => {
    saved = await savedTwin();
    live = await startStoredRunner(
      join(saved.dir, 'live.yaml'),
      saved.snapshot,
    );
  }, TIMEOUT);

  afterAll(async () => {
    await (live && stopRunner(live));
    rmSync(saved.dir, { recursive: true, force: true });
  });

  it('Should refuse --what-if for a class without whatIf.replay', async () => {
    const started = startStoredRunner(
      join(saved.dir, 'plain.yaml'),
      saved.snapshot,
      1,
    );

    await expect(started).rejects.toThrow(
      'Can not start a replay twin: the class has no whatIf.replay: true',
    );
  });

  it('Should have null for replay in /dt', async () => {
    const { body } = await call(live, liveAs(), ['get', '/dt']);

    expect(body.replay).toBeNull();
  });

  it('Should answer 404 on the notice route, to any caller', async () => {
    const notice = { kind: 'state', data: {} };
    const asOperator = await call(live, liveAs(), [
      'put',
      '/peers/dt-8/notice',
      notice,
    ]);
    const asClient = await call(live, liveAs(client), [
      'put',
      '/peers/dt-8/notice',
      notice,
    ]);

    expect([asOperator.status, asClient.status]).toEqual([404, 404]);
  });

  it('Should keep the rights of an operator', async () => {
    const { status } = await call(live, liveAs(), [
      'post',
      '/fsm/transition',
      { state: 'work' },
    ]);

    expect(status).toBe(403);
  });

  it('Should ignore the origin headers, and stamp no row', async () => {
    const headers = { 'Replay-By': 'a b', 'Replay-Seq': 'first' };
    const moved = await call(
      live,
      liveAs(client),
      ['post', '/fsm/transition', { state: 'done' }],
      headers,
    );
    const rows = await rowsSince(live, 'dt-1.live', saved);

    expect(moved.status).toBeLessThan(300);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => 'at' in row || 'origin' in row)).toBe(false);
  });
});
