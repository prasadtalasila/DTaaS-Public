import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import ExecaManager from 'src/execa-manager.service';
import FsmService from 'src/fsm/fsm.service';
import { startRunner } from './util';
import { http, startTwin, touch } from './snapshot.util';
import { call, client, controlAccess, whatIfTwin } from './whatif.util';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

describe('Refusals of a what-if end-to-end', () => {
  let dir: string;
  let app: INestApplication | undefined;

  afterEach(async () => {
    touch(dir, 'go');
    await app?.get(ExecaManager).stop();
    await app?.close();
    app = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  async function start(save?: string, snapshots?: boolean) {
    dir = whatIfTwin(save, snapshots);
    app = await startTwin(dir);
    controlAccess(app);
    return app;
  }

  const ask = (twin: INestApplication, name: string) =>
    call(twin, client, ['post', '/whatif', { name }]);

  it('Should refuse a command that whatIf.commands lacks', async () => {
    const { status, body } = await ask(await start(), 'work');

    expect(status).toBe(400);
    expect(body).toEqual({ status: 'invalid command' });
  });

  it('Should refuse a what-if without a database file', async () => {
    dir = whatIfTwin();
    app = await startRunner(join(dir, 'runner.yaml'));
    controlAccess(app);

    const { status, body } = await ask(app, 'forecast');

    expect(status).toBe(409);
    expect(body).toEqual({ status: 'no database' });
  });

  it('Should refuse a what-if without a snapshot directory', async () => {
    const { status, body } = await ask(
      await start('save-ward', false),
      'forecast',
    );

    expect(status).toBe(409);
    expect(body).toEqual({ status: 'no snapshot directory' });
  });

  it('Should refuse a what-if without access control', async () => {
    dir = whatIfTwin();
    app = await startTwin(dir);

    const { status, body } = await http(app)
      .post('/whatif')
      .send({ name: 'forecast' });

    expect(status).toBe(409);
    expect(body).toEqual({ status: 'no access control' });
    expect(existsSync(join(dir, 'snapshots', 'what-if'))).toBe(false);
  });

  it(
    'Should answer a failed save script with its outcome, and leave no copy',
    async () => {
      const { status, body } = await ask(await start('fail-save'), 'forecast');

      expect(status).toBe(500);
      expect(body).toMatchObject({ status: 'failed', result: { exitCode: 3 } });
      expect(readdirSync(join(dir, 'snapshots', 'what-if'))).toEqual([]);
    },
    TIMEOUT,
  );

  it('Should refuse a what-if during a save, with Retry-After', async () => {
    const twin = await start();
    twin.get(FsmService).pause.begin();

    const { status, body, headers } = await ask(twin, 'forecast');
    twin.get(FsmService).pause.end();

    expect(status).toBe(503);
    expect(body).toEqual({ status: 'saving' });
    expect(headers['retry-after']).toBe('1');
  });

  it(
    'Should answer 404 for an id that is no what-if run',
    async () => {
      const twin = await start();
      await call(twin, client, ['post', '/', { name: 'work' }]);

      const live = await call(twin, client, ['get', '/whatif/1']);
      const none = await call(twin, client, ['get', '/whatif/99']);

      expect(live.status).toBe(404);
      expect(none.status).toBe(404);
    },
    TIMEOUT,
  );

  it(
    'Should stop a what-if as it shuts down, and remove its copy',
    async () => {
      const twin = await start();
      await ask(twin, 'forecast-slow');

      await twin.close();
      app = undefined;

      expect(readdirSync(join(dir, 'snapshots', 'what-if'))).toEqual([]);
    },
    TIMEOUT,
  );

  it('Should remove the copies that a crashed runner left', async () => {
    dir = whatIfTwin();
    const left = join(dir, 'snapshots', 'what-if', '20261123T101502120Z');
    mkdirSync(left, { recursive: true });
    writeFileSync(join(left, 'state.json'), '{}');

    app = await startTwin(dir);

    expect(existsSync(join(dir, 'snapshots', 'what-if'))).toBe(false);
    expect(existsSync(join(dir, 'snapshots'))).toBe(true);
  });
});
