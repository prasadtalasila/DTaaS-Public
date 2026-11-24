import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import DescriptorService from 'src/descriptor.service';
import { http, snapshotTwin, startTwin, touch } from './snapshot.util';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

type Row = { seq: number; kind: string };

// The machine and the timeline of a database file
function contents(file: string) {
  const db = new DatabaseSync(file);
  const machine = db.prepare('SELECT state, entry, status FROM machine').get();
  const rows = db.prepare('SELECT seq, kind FROM timeline').all() as Row[];
  db.close();
  return { machine, rows };
}

// A save with stop while the script of work runs, which the shutdown
// stops; the runner shuts down as main.ts makes it
describe('Taking a twin out of execution end-to-end', () => {
  let dir: string;
  let app: INestApplication;
  let reply: Response;

  beforeAll(async () => {
    dir = snapshotTwin();
    app = await startTwin(dir);
    const closed = new Promise<void>((resolve) => {
      app
        .get(DescriptorService)
        .snapshots()
        .onStop(async () => {
          await app.close();
          resolve();
        });
    });
    touch(dir, 'release');
    await http(app).post('/fsm/transition').send({ state: 'work' });
    reply = await http(app).post('/snapshot').send({ stop: true });
    await closed;
  }, TIMEOUT);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should answer the save before it shuts down', () => {
    expect(reply.status).toBe(201);
    expect(reply.body).toEqual({
      time: expect.any(String),
      seq: expect.any(Number),
      path: expect.stringContaining('snapshots'),
    });
  });

  it('Should shut down gracefully, with nothing changed after the snapshot', () => {
    const { machine, rows } = contents(join(dir, 'run', 'dt.db'));
    const saved = contents(join(dir, reply.body.path, 'state.db'));
    const snapshot = rows.findIndex(({ kind }) => kind === 'snapshot');
    const after = rows.slice(snapshot + 1).map(({ kind }) => kind);

    expect(machine).toEqual({ state: 'work', entry: 1, status: 'running' });
    expect(saved.machine).toEqual(machine);
    expect(saved.rows.at(-1)?.seq).toBe(reply.body.seq);
    expect(after.filter((kind) => !['sent', 'exit'].includes(kind))).toEqual([
      'shutdown',
    ]);
  });
});
