import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import DescriptorService from 'src/descriptor.service';
import ExecaManager from 'src/execa-manager.service';
import { http, snapshotTwin, startTwin, touch, until } from './snapshot.util';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

describe('Failed saves end-to-end', () => {
  let dir: string;
  let app: INestApplication;
  let stop: jest.Mock<() => Promise<void>>;

  async function start(save: string): Promise<void> {
    dir = snapshotTwin(save);
    app = await startTwin(dir);
    stop = jest.fn(() => Promise.resolve());
    app.get(DescriptorService).snapshots().onStop(stop);
  }

  // The twin goes on: it is no longer saving and takes a transition
  async function goesOn(): Promise<void> {
    const health = await http(app).get('/health');
    const reply = await http(app)
      .post('/fsm/transition')
      .send({ state: 'done' });

    expect(health.body.saving).toBe(false);
    expect(reply.status).toBe(202);
    expect(stop).not.toHaveBeenCalled();
  }

  const snapshots = () =>
    existsSync(join(dir, 'snapshots'))
      ? readdirSync(join(dir, 'snapshots'))
      : [];

  afterEach(async () => {
    await app.get(ExecaManager).stop();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it(
    'Should answer 500 with the outcome of a save script that fails',
    async () => {
      await start('fail-save');

      const { status, body } = await http(app)
        .post('/snapshot')
        .send({ stop: true });

      expect(status).toBe(500);
      expect(body).toMatchObject({
        status: 'failed',
        result: { exitCode: 3, stderr: expect.stringContaining('no ward') },
      });
      expect(snapshots()).toEqual([]);
      await goesOn();
    },
    TIMEOUT,
  );

  it(
    'Should stop a save script that passes the timeout',
    async () => {
      await start('loop');

      const { status, body } = await http(app).post('/snapshot').send({});

      expect(status).toBe(500);
      expect(body).toMatchObject({ status: 'stopped' });
      expect(snapshots()).toEqual([]);
      await goesOn();
    },
    TIMEOUT,
  );

  it(
    'Should refuse a save while a client runs the save script',
    async () => {
      await start('save-ward');
      const run = http(app)
        .post('/')
        .send({ name: 'save-ward' })
        .then((reply) => reply);
      await until(() =>
        Promise.resolve(app.get(ExecaManager).isRunning('save-ward')),
      );

      const { status, body } = await http(app).post('/snapshot').send({});
      touch(dir, 'release');

      expect([status, body]).toEqual([409, { status: 'save script running' }]);
      expect(snapshots()).toEqual([]);
      expect((await run).status).toBe(200);
      await goesOn();
    },
    TIMEOUT,
  );

  it('Should refuse a body that is not a save', async () => {
    await start('save-ward');

    const { status } = await http(app).post('/snapshot').send({ stop: 1 });

    expect(status).toBe(400);
  });
});
