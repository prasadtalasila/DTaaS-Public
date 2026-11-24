import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import ExecaManager from 'src/execa-manager.service';
import { TimelineRow } from 'src/dto/timeline.dto';
import { http, until } from './snapshot.util';
import { reinstated, reinstateTwin } from './reinstate.util';
import { startStoredRunner } from './util';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

const READS = ['/history', '/parameters', '/properties', '/peers'];

type Seen = Record<string, unknown>;

async function read(app: INestApplication): Promise<Seen> {
  const replies = await Promise.all(READS.map((route) => http(app).get(route)));
  return Object.fromEntries(replies.map(({ body }, i) => [READS[i], body]));
}

const rows = async (app: INestApplication): Promise<TimelineRow[]> =>
  (await http(app).get('/timeline?limit=1000')).body;

// The twin dt-1 with a changed parameter, a property, a peer switched
// off, and in work, whose script runs
async function changeTwin(app: INestApplication): Promise<void> {
  await http(app).put('/parameters').send({ capacity: 4 });
  await http(app).put('/peers').send({ 'dt-8': false });
  await http(app).put('/properties').send({ beds: 3 });
  await http(app).post('/fsm/transition').send({ state: 'work' });
}

async function stopRunner(app: INestApplication): Promise<void> {
  await app.get(ExecaManager).stop();
  await app.close();
}

describe('Reinstating a twin end-to-end', () => {
  let dir: string;
  let second: INestApplication;
  let saved: Response;
  let first: Seen;
  let firstRows: TimelineRow[];

  beforeAll(async () => {
    dir = reinstateTwin();
    const app = await startStoredRunner(join(dir, 'runner.yaml'));
    await changeTwin(app);
    saved = await http(app).post('/snapshot').send({});
    first = await read(app);
    firstRows = await rows(app);
    await stopRunner(app);
    second = await reinstated(dir, 'second.yaml', saved.body.path);
  }, TIMEOUT);

  afterAll(async () => {
    await (second && stopRunner(second));
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should have saved the twin', () => {
    expect(saved.status).toBe(201);
  });

  it('Should have the parameters, the properties and the peers of the first', async () => {
    const now = await read(second);

    expect(now['/parameters']).toEqual(first['/parameters']);
    expect(now['/properties']).toEqual(first['/properties']);
    expect(now['/peers']).toEqual(first['/peers']);
    expect((await http(second).get('/dt')).body.peers).toEqual(['dt-9']);
  });

  it('Should have the command history of the first at the save, and the restore script', async () => {
    type Entry = { id: number; name: string; status: string };
    const history = (await read(second))['/history'] as Entry[];
    const work = (first['/history'] as Entry[]).find(
      ({ name }) => name === 'work',
    );

    expect(history.map(({ name }) => name).sort()).toEqual([
      'restore-ward',
      'work',
    ]);
    expect(history).toContainEqual(
      expect.objectContaining({ id: work?.id, status: 'interrupted' }),
    );
  });

  it('Should have the timeline of the first up to the save', async () => {
    const seq = saved.body.seq;
    const before = (all: TimelineRow[]) => all.filter((row) => row.seq <= seq);

    expect(before(await rows(second))).toEqual(before(firstRows));
  });

  it('Should have run the restore script, which brought the file back', () => {
    const restored = readFileSync(join(dir, 'restored.json'), 'utf8');

    expect(JSON.parse(restored)).toEqual({ beds: 3 });
  });

  it('Should name the snapshot in its start row', async () => {
    const starts = (await rows(second)).filter(({ kind }) => kind === 'start');
    const manifest = JSON.parse(
      readFileSync(join(dir, saved.body.path, 'snapshot.json'), 'utf8'),
    );

    expect(starts.at(-1)?.data.reinstated).toEqual({
      id: 'dt-1',
      time: manifest.time,
      seq: manifest.seq,
    });
    expect(starts[0].data.reinstated).toBeUndefined();
  });

  it('Should wait in the saved state as interrupted, and move on at an event', async () => {
    const { body } = await http(second).get('/fsm');

    expect(body).toMatchObject({ state: 'work', status: 'interrupted' });
    await http(second).post('/fsm/event').send({ event: 'next' });
    await until(
      async () => (await http(second).get('/fsm')).body.state === 'done',
    );
  });
});
