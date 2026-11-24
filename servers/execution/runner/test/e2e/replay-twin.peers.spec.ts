import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import DescriptorService from 'src/descriptor.service';
import { http, until } from './snapshot.util';
import { call, operator, replayTwin, stopRunner } from './replay-twin.util';
import { startStoredRunner } from './util';

const TIMEOUT = 30000;

// The twin dt-1 heard dt-8 go offline before it was saved idle; its
// subscription moves idle to done when dt-8 goes offline
async function savedAfterNotice(dir: string): Promise<string> {
  const twin = await startStoredRunner(join(dir, 'runner.yaml'));
  twin
    .get(DescriptorService)
    .peers()
    .observe('dt-8', 'presence', { online: false });
  await http(twin).post('/fsm/transition').send({ state: 'idle' });
  await until(
    async () => (await http(twin).get('/fsm')).body.status === 'valid',
  );
  const { path } = (await http(twin).post('/snapshot').send({})).body;
  await stopRunner(twin);
  return join(dir, path);
}

describe('What a replay twin knows of its peers at its start', () => {
  let dir: string;
  let replay: INestApplication;

  const as = [operator, 'dt-1.replay'] as const;

  const notice = (online: boolean) =>
    call(
      replay,
      as,
      ['put', '/peers/dt-8/notice', { kind: 'presence', data: { online } }],
      {
        'Replay-Seq': '1',
      },
    );

  const state = async () =>
    (await call(replay, as, ['get', '/fsm'])).body.state;

  beforeAll(async () => {
    dir = replayTwin();
    const snapshot = await savedAfterNotice(dir);
    replay = await startStoredRunner(join(dir, 'replay.yaml'), snapshot, 1000);
  }, TIMEOUT);

  afterAll(async () => {
    await (replay && stopRunner(replay));
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should show the last notice of each peer in GET /peers', async () => {
    const { body } = await call(replay, as, ['get', '/peers']);
    expect(body['dt-8']).toMatchObject({ online: false });
  });

  it(
    'Should raise nothing for an equal notice, and the event for a change',
    async () => {
      await notice(false);
      const unchanged = await state();
      await notice(true);
      await notice(false);
      await until(async () => (await state()) === 'done');

      expect(unchanged).toBe('idle');
      expect(await state()).toBe('done');
    },
    TIMEOUT,
  );
});
