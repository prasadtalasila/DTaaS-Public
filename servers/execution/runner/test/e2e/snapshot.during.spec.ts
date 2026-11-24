import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import { TimelineRow } from 'src/dto/timeline.dto';
import ExecaManager from 'src/execa-manager.service';
import {
  http,
  saving,
  snapshotTwin,
  startTwin,
  touch,
  until,
} from './snapshot.util';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

// Every route that changes the twin, with a body that it would take
const CHANGES: Array<[string, string, object]> = [
  ['post', '/fsm/transition', { state: 'done' }],
  ['post', '/fsm/event', { event: 'again' }],
  ['post', '/escalate', { reason: 'help' }],
  ['post', '/', { name: 'done' }],
  ['post', '/stop', {}],
  ['put', '/parameters', {}],
  ['put', '/peers', {}],
  ['put', '/properties', {}],
  ['post', '/snapshot', {}],
];

const READS = [
  '/',
  '/dt',
  '/state',
  '/fsm',
  '/history',
  '/metrics',
  '/parameters',
  '/peers',
  '/properties',
  '/timeline',
  '/snapshot',
  '/health',
];

const rows = async (app: INestApplication): Promise<TimelineRow[]> =>
  (await http(app).get('/timeline')).body;

const exited = async (app: INestApplication) =>
  (await rows(app)).some(({ kind }) => kind === 'exit');

// One save while the script of work runs: it ends during the save, and
// the requests of the tests come in between
describe('Requests during a save end-to-end', () => {
  let dir: string;
  let app: INestApplication;
  let saved: Promise<Response>;
  const during: Record<string, Response> = {};
  let machine: Record<string, unknown>;

  beforeAll(async () => {
    dir = snapshotTwin();
    app = await startTwin(dir);
    await http(app).post('/fsm/transition').send({ state: 'work' });
    saved = http(app)
      .post('/snapshot')
      .send({})
      .then((reply) => reply);
    await until(() => saving(app));
    const changes = CHANGES.map(([method, route, body]) =>
      http(app)[method as 'post' | 'put'](route).send(body),
    );
    const reads = READS.map((route) => http(app).get(route));
    const replies = await Promise.all([...changes, ...reads]);
    [...CHANGES.map(([, route]) => route), ...READS].forEach((route, index) => {
      during[`${index < CHANGES.length ? 'change' : 'read'} ${route}`] =
        replies[index];
    });
    touch(dir, 'go');
    await until(() => exited(app));
    machine = (await http(app).get('/fsm')).body;
    touch(dir, 'release');
  }, TIMEOUT);

  afterAll(async () => {
    touch(dir, 'go');
    touch(dir, 'release');
    await saved;
    await app.get(ExecaManager).stop();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(CHANGES.map(([, route]) => route))(
    'Should refuse %s with 503 saving and a Retry-After',
    (route) => {
      const { status, body, headers } = during[`change ${route}`];

      expect([status, body]).toEqual([503, { status: 'saving' }]);
      expect(headers['retry-after']).toBe('1');
    },
  );

  it.each(READS)('Should answer the read %s', (route) => {
    const { status } = during[`read ${route}`];

    expect(status).toBeLessThan(300);
  });

  it('Should report the save in the health', () => {
    expect(during['read /health'].body.saving).toBe(true);
  });

  it('Should hold the completion of a script that ended during the save', () => {
    expect(machine).toMatchObject({ state: 'work', entry: 1 });
  });

  it(
    'Should handle the held completion once the save has ended',
    async () => {
      const { status, body } = await saved;
      await until(async () => (await http(app).get('/fsm')).body.entry === 2);

      const timeline = await rows(app);
      const seqOf = (kind: string, entry?: number) =>
        timeline.find(
          (row) =>
            row.kind === kind &&
            (entry === undefined || row.data.entry === entry),
        )?.seq;
      const manifest = JSON.parse(
        readFileSync(join(dir, body.path, 'snapshot.json'), 'utf8'),
      );
      expect(status).toBe(201);
      expect(manifest.machine).toEqual({
        state: 'work',
        entry: 1,
        status: 'running',
      });
      expect(seqOf('exit', 1)).toBeLessThan(seqOf('snapshot') as number);
      expect(seqOf('snapshot')).toBeLessThan(seqOf('entry', 2) as number);
      expect((await http(app).get('/health')).body.saving).toBe(false);
    },
    TIMEOUT,
  );
});
