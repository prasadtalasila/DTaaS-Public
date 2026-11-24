import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { TimelineRow } from 'src/dto/timeline.dto';
import { until } from './snapshot.util';
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

const SCALE = 1000;

describe('A replay twin end-to-end', () => {
  let saved: Saved;
  let replay: INestApplication;

  const replayAs = (caller = operator) => [caller, 'dt-1.replay'] as const;

  const rows = () => rowsSince(replay, 'dt-1.replay', saved);

  const state = async () =>
    (await call(replay, replayAs(), ['get', '/fsm'])).body.state;

  beforeAll(async () => {
    saved = await savedTwin();
    const { dir, snapshot } = saved;
    replay = await startStoredRunner(join(dir, 'replay.yaml'), snapshot, SCALE);
  }, TIMEOUT);

  afterAll(async () => {
    await (replay && stopRunner(replay));
    rmSync(saved.dir, { recursive: true, force: true });
  });

  it('Should say what it is in /dt', async () => {
    const { body } = await call(replay, replayAs(), ['get', '/dt']);

    expect(body.replay).toEqual({ of: 'dt-1', time: saved.manifest.time });
  });

  it('Should wait in the saved state', async () => {
    expect(await state()).toBe('idle');
  });

  it(
    'Should let its operator move it, and record the origin',
    async () => {
      const headers = { 'Replay-By': 'cli', 'Replay-Seq': '5' };
      const moved = await call(
        replay,
        replayAs(),
        ['post', '/fsm/transition', { state: 'work' }],
        headers,
      );
      const written = await rows();
      const transition = written.find(({ kind }) => kind === 'transition');

      expect(moved.status).toBeLessThan(300);
      expect(transition).toMatchObject({
        by: 'replay',
        origin: { by: 'cli', seq: 5 },
      });
      expect(written.find(({ kind }) => kind === 'entry')).not.toHaveProperty(
        'origin',
      );
    },
    TIMEOUT,
  );

  it(
    'Should give its scripts the mode, the twin and the scale',
    async () => {
      const file = join(saved.dir, 'env');
      await until(async () => existsSync(file));
      await until(async () => readFileSync(file, 'utf8').includes('DT_ID'));
      const env = readFileSync(file, 'utf8');

      expect(env).toMatch(/^DT_MODE=what-if$/m);
      expect(env).toMatch(/^DT_REPLAY_OF=dt-1$/m);
      expect(env).toMatch(new RegExp(`^DT_TIME_SCALE=${SCALE}$`, 'm'));
      expect(env).not.toMatch(/^DT_WHATIF_DIR=/m);
    },
    TIMEOUT,
  );

  it('Should refuse malformed origin headers', async () => {
    const { status } = await call(replay, replayAs(), ['get', '/fsm'], {
      'Replay-By': 'cli',
      'Replay-Seq': 'first',
    });

    expect(status).toBe(400);
  });

  it('Should refuse a notice of a peer that runner.yaml lacks, or no notice', async () => {
    const unknown = await call(replay, replayAs(), [
      'put',
      '/peers/dt-9/notice',
      { kind: 'state', data: {} },
    ]);
    const malformed = await call(replay, replayAs(), [
      'put',
      '/peers/dt-8/notice',
      { kind: 'presence', data: { online: 'no' } },
    ]);

    expect([unknown.status, malformed.status]).toEqual([400, 400]);
  });

  it('Should take a notice from its operator alone', async () => {
    const { status } = await call(replay, replayAs(client), [
      'put',
      '/peers/dt-8/notice',
      { kind: 'state', data: {} },
    ]);

    expect(status).toBe(403);
  });

  it(
    'Should take a notice as if it came over MQTT',
    async () => {
      await call(replay, replayAs(), [
        'post',
        '/fsm/transition',
        { state: 'idle' },
      ]);
      await until(async () => (await state()) === 'idle');
      const { status, body } = await call(
        replay,
        replayAs(),
        [
          'put',
          '/peers/dt-8/notice',
          { kind: 'presence', data: { online: false } },
        ],
        { 'Replay-Seq': '9' },
      );
      await until(async () => (await state()) === 'done');
      const written = await rows();
      const notice = written.find(({ kind }) => kind === 'notice');
      const event = written.find(({ kind }) => kind === 'event');

      expect([status, body['dt-8'].online]).toEqual([200, false]);
      expect(notice).toMatchObject({
        by: null,
        data: { peer: 'dt-8', kind: 'presence', data: { online: false } },
        origin: { by: null, seq: 9 },
      });
      expect(event?.data).toMatchObject({
        event: 'neighbour-down',
        source: 'peer',
      });
      expect(event).not.toHaveProperty('origin');
    },
    TIMEOUT,
  );

  it('Should stamp each of its rows with the time that it stands for', async () => {
    const all = await rows();
    const [first, last] = [all[0], all.at(-1) as TimelineRow];
    const real = Date.parse(last.time) - Date.parse(first.time);
    const stood = Date.parse(last.at ?? '') - Date.parse(first.at ?? '');

    expect(all.every(({ at }) => at !== undefined)).toBe(true);
    expect(Date.parse(first.at ?? '')).toBeGreaterThanOrEqual(
      Date.parse(saved.manifest.time),
    );
    expect(Math.abs(stood - real * SCALE)).toBeLessThanOrEqual(3 * SCALE);
    expect(real).toBeGreaterThan(0);
  });
});
