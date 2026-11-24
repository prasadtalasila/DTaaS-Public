import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import * as yaml from 'js-yaml';
import ExecaManager from 'src/execa-manager.service';
import { startRunner } from './util';
import { http, snapshotTwin, startTwin, touch, until } from './snapshot.util';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

const fsmState = async (app: INestApplication) =>
  (await http(app).get('/fsm')).body;

describe('Saving a twin end-to-end', () => {
  let dir: string;
  let app: INestApplication;

  beforeEach(async () => {
    dir = snapshotTwin();
    app = await startTwin(dir);
  });

  afterEach(async () => {
    touch(dir, 'go');
    touch(dir, 'release');
    await app.get(ExecaManager).stop();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // A save of the twin settled in done, with the save script released
  async function saveDone() {
    await http(app).post('/fsm/transition').send({ state: 'work' });
    touch(dir, 'go');
    touch(dir, 'release');
    await until(async () => {
      const { state, status } = await fsmState(app);
      return state === 'done' && status === 'valid';
    });
    return http(app).post('/snapshot').send({});
  }

  it(
    'Should write every part of the snapshot',
    async () => {
      const { status, body } = await saveDone();

      const name = body.path.slice('snapshots/'.length);
      const snapshot = join(dir, 'snapshots', name);
      const read = (file: string) => readFileSync(join(snapshot, file), 'utf8');
      expect(status).toBe(201);
      expect(body).toEqual({
        time: expect.any(String),
        seq: expect.any(Number),
        path: join('snapshots', name),
      });
      expect(name).toBe(body.time.replace(/[-:.]/g, ''));
      expect(readdirSync(snapshot).sort()).toEqual([
        'files',
        'runner.yaml',
        'scripts',
        'snapshot.json',
        'state.db',
        'ward.fsm.yaml',
      ]);
      expect(JSON.parse(read('snapshot.json'))).toEqual({
        format: 1,
        runner: JSON.parse(readFileSync('package.json', 'utf8')).version,
        id: 'dt-1',
        class: { id: 'urn:dtaas:ward', version: '1.0.0' },
        time: body.time,
        seq: body.seq,
        machine: { state: 'done', entry: 2, status: 'valid' },
      });
      expect(read('files/ward.json')).toBe('{"beds":3}');
      expect(read('ward.fsm.yaml')).toBe(
        readFileSync(join(dir, 'ward.fsm.yaml'), 'utf8'),
      );
      expect(readdirSync(join(snapshot, 'scripts'))).toEqual(
        readdirSync(join(dir, 'scripts')),
      );
    },
    TIMEOUT,
  );

  it(
    'Should blank the two secrets in the copy of runner.yaml',
    async () => {
      const { body } = await saveDone();

      const copy = yaml.load(
        readFileSync(join(dir, body.path, 'runner.yaml'), 'utf8'),
      ) as Record<string, Record<string, unknown>>;
      expect(copy.mqtt.password).toBe('');
      expect(copy.relationships).toEqual({
        manager: { notify: { url: 'http://127.0.0.1:1/events', token: '' } },
      });
      expect(copy.database).toBe('run/dt.db');
    },
    TIMEOUT,
  );

  it(
    'Should copy a database that ends at the row before the snapshot row',
    async () => {
      const { body } = await saveDone();

      const copy = new DatabaseSync(join(dir, body.path, 'state.db'));
      const last = copy.prepare('SELECT MAX(seq) AS seq FROM timeline').get();
      const machine = copy.prepare('SELECT state, entry FROM machine').get();
      copy.close();
      const after = await http(app).get(
        `/timeline?after=${body.seq}&kind=snapshot`,
      );
      expect(last).toEqual({ seq: body.seq });
      expect(machine).toEqual({ state: 'done', entry: 2 });
      expect(after.body).toEqual([
        {
          seq: expect.any(Number),
          time: expect.any(String),
          kind: 'snapshot',
          by: null,
          data: { time: body.time, name: body.path.slice('snapshots/'.length) },
        },
      ]);
    },
    TIMEOUT,
  );

  it(
    'Should run the save script as a command of the history',
    async () => {
      await saveDone();

      const { body } = await http(app).get('/history');
      expect(body.at(-1)).toMatchObject({ name: 'save-ward', status: 'valid' });
    },
    TIMEOUT,
  );

  it(
    'Should list the snapshots oldest first and remove one',
    async () => {
      const first = (await saveDone()).body;
      const second = (await http(app).post('/snapshot').send({})).body;
      const name = first.path.slice('snapshots/'.length);

      expect((await http(app).get('/snapshot')).body).toEqual([first, second]);
      expect((await http(app).delete(`/snapshot/${name}`)).status).toBe(204);
      expect((await http(app).get('/snapshot')).body).toEqual([second]);
      expect((await http(app).delete(`/snapshot/${name}`)).status).toBe(404);
      expect((await http(app).delete('/snapshot/runner.yaml')).status).toBe(
        404,
      );
    },
    TIMEOUT,
  );
});

describe('Refused saves end-to-end', () => {
  let dir: string;
  let app: INestApplication;

  beforeEach(() => {
    dir = snapshotTwin();
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should refuse a runner that keeps its database in memory', async () => {
    app = await startRunner(join(dir, 'runner.yaml'));

    const { status, body } = await http(app).post('/snapshot').send({});

    expect([status, body]).toEqual([409, { status: 'no database' }]);
  });

  it('Should refuse a runner without a snapshot directory', async () => {
    const file = join(dir, 'runner.yaml');
    const config = readFileSync(file, 'utf8');
    writeFileSync(file, config.replace(/snapshots:\n.*\n.*\n/, ''));
    app = await startTwin(dir);

    const { status, body } = await http(app).post('/snapshot').send({});

    expect([status, body]).toEqual([409, { status: 'no snapshot directory' }]);
    expect((await http(app).get('/snapshot')).status).toBe(409);
  });
});
