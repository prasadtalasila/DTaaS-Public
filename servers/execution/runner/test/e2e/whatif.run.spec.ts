import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import ExecaManager from 'src/execa-manager.service';
import FsmService from 'src/fsm/fsm.service';
import { startTwin, touch, until } from './snapshot.util';
import {
  call,
  client,
  controlAccess,
  ended,
  manager,
  whatIfTwin,
} from './whatif.util';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

describe('Runs of a what-if end-to-end', () => {
  let dir: string;
  let app: INestApplication;

  beforeEach(async () => {
    dir = whatIfTwin();
    app = await startTwin(dir);
    controlAccess(app);
    app.get(FsmService).setRunnerApi('http://127.0.0.1:5000', 'token-1');
  });

  afterEach(async () => {
    touch(dir, 'go');
    await app.get(ExecaManager).stop();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const ask = (name: string, caller = client) =>
    call(app, caller, ['post', '/whatif', { name }]);

  const copies = () => join(dir, 'snapshots', 'what-if');

  const listed = () => (existsSync(copies()) ? readdirSync(copies()) : []);

  const gone = () => Promise.resolve(listed().length === 0);

  it(
    'Should stop a what-if, remove its copy, and keep the copy private while it runs',
    async () => {
      const { body } = await ask('forecast-slow');
      const [copy] = listed();
      const { mode } = statSync(join(copies(), copy));
      const stopped = await call(app, client, [
        'post',
        '/stop',
        { name: 'forecast-slow' },
      ]);
      const run = await ended(app, body.id);
      await until(gone);

      if (process.platform !== 'win32') {
        expect(mode & 0o777).toBe(0o700);
      }
      expect(stopped.body).toEqual({ stopped: ['forecast-slow'] });
      expect(run).toMatchObject({ status: 'stopped', exitCode: null });
    },
    TIMEOUT,
  );

  it(
    'Should join a what-if of a command whose what-if runs, without a second copy',
    async () => {
      const first = await ask('forecast-slow');
      const second = await ask('forecast-slow');

      expect(second.status).toBe(202);
      expect(second.body).toEqual(first.body);
      expect(listed()).toHaveLength(1);
      touch(dir, 'go');
      expect(await ended(app, first.body.id)).toMatchObject({
        status: 'valid',
        result: { ok: true },
      });
    },
    TIMEOUT,
  );

  it(
    'Should refuse a what-if of a command that runs live, and leave no copy',
    async () => {
      const live = call(app, client, ['post', '/', { name: 'forecast-slow' }]);
      const done = live.then((reply) => reply.body);
      await until(() =>
        Promise.resolve(app.get(ExecaManager).isRunning('forecast-slow')),
      );

      const { status, body } = await ask('forecast-slow');

      expect(status).toBe(409);
      expect(body).toEqual({ status: 'command running' });
      expect(listed()).toEqual([]);
      touch(dir, 'go');
      expect(await done).toMatchObject({ status: 'success' });
    },
    TIMEOUT,
  );

  it.each([[undefined], [{ now: true }]])(
    'Should refuse a live run, with the input %j, of a command whose what-if runs',
    async (input) => {
      await ask('forecast-slow');

      const { status, body } = await call(app, client, [
        'post',
        '/',
        { name: 'forecast-slow', input },
      ]);

      expect(status).toBe(409);
      expect(body).toEqual({ status: 'what-if running' });
    },
    TIMEOUT,
  );

  it(
    'Should give a live run the live mode and the token',
    async () => {
      await call(app, client, ['post', '/', { name: 'forecast', input: {} }]);

      const env = readFileSync(join(dir, 'env'), 'utf8');
      expect(env).toMatch(/^DT_MODE=live$/m);
      expect(env).toMatch(/^RUNNER_TOKEN=token-1$/m);
    },
    TIMEOUT,
  );

  it(
    'Should keep the copies out of the list of snapshots',
    async () => {
      await ask('forecast-slow');

      const list = await call(app, client, ['get', '/snapshot']);
      const removed = await call(app, client, ['delete', '/snapshot/what-if']);

      expect(list.body).toEqual([]);
      expect(removed.status).toBe(404);
      expect(listed()).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'Should let a manager ask only for a command that both lists hold',
    async () => {
      const allowed = await ask('forecast', manager);
      const refused = await ask('forecast-text', manager);
      const read = await call(app, manager, [
        'get',
        `/whatif/${allowed.body.id}`,
      ]);

      expect(allowed.status).toBe(202);
      expect(refused.status).toBe(403);
      expect(refused.body.message).toBe('manager may not call whatif');
      expect(read.status).toBe(200);
      await ended(app, allowed.body.id);
    },
    TIMEOUT,
  );
});
