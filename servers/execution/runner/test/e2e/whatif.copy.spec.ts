import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import Config from 'src/config/configuration.service';
import ExecaManager from 'src/execa-manager.service';
import { ScriptUser } from 'src/scripts/separation';
import { startStoredRunner } from './util';
import { saving, startTwin, touch, until } from './snapshot.util';
import { call, client, controlAccess, ended, whatIfTwin } from './whatif.util';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

describe('The copy of a what-if end-to-end', () => {
  let dir: string;
  let app: INestApplication | undefined;

  afterEach(async () => {
    touch(dir, 'go');
    touch(dir, 'release');
    await app?.get(ExecaManager).stop();
    await app?.close();
    app = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  async function start(save = 'save-slow') {
    dir = whatIfTwin(save);
    app = await startTwin(dir);
    controlAccess(app);
    return app;
  }

  const ask = (twin: INestApplication, name: string) =>
    call(twin, client, ['post', '/whatif', { name }]);

  const copies = () => {
    const root = join(dir, 'snapshots', 'what-if');
    return existsSync(root) ? readdirSync(root) : [];
  };

  it(
    'Should join a request that comes while the copy is made',
    async () => {
      const twin = await start();
      const first = ask(twin, 'forecast-text').then((reply) => reply);
      await until(() => saving(twin));
      const second = ask(twin, 'forecast-text').then((reply) => reply);
      touch(dir, 'release');

      const [one, two] = await Promise.all([first, second]);

      expect([one.status, two.status]).toEqual([202, 202]);
      expect(two.body).toEqual(one.body);
      expect(await ended(twin, one.body.id)).toMatchObject({ status: 'valid' });
    },
    TIMEOUT,
  );

  it(
    'Should stop a what-if whose copy is being made as it shuts down',
    async () => {
      const twin = await start();
      const asked = ask(twin, 'forecast-slow').then((reply) => reply.status);
      await until(() => saving(twin));

      const closed = twin.close();
      touch(dir, 'release');
      await closed;
      app = undefined;

      expect(await asked).toBe(202);
      expect(copies()).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'Should refuse a what-if, and its joiners, when the command starts live during the copy',
    async () => {
      const twin = await start();
      const first = ask(twin, 'forecast-slow').then((reply) => reply);
      await until(() => saving(twin));
      const second = ask(twin, 'forecast-slow').then((reply) => reply);
      // a run that no route guard stops, as a resumed state entry
      const live = twin.get(ExecaManager).newCommand('forecast-slow');
      touch(dir, 'release');

      const replies = await Promise.all([first, second]);

      expect(replies.map(({ status }) => status)).toEqual([409, 409]);
      expect(replies[0].body).toEqual({ status: 'command running' });
      await until(() => Promise.resolve(copies().length === 0));
      const rows = (await call(twin, client, ['get', '/timeline?kind=whatif']))
        .body;
      expect(rows).toEqual([]);
      touch(dir, 'go');
      expect((await live)[0]).toBe('success');
      expect((await ask(twin, 'forecast-text')).status).toBe(202);
    },
    TIMEOUT,
  );

  it(
    'Should refuse a what-if while the save script runs',
    async () => {
      const twin = await start();
      const live = call(twin, client, ['post', '/', { name: 'save-slow' }]);
      const done = live.then((reply) => reply.status);
      await until(() =>
        Promise.resolve(twin.get(ExecaManager).isRunning('save-slow')),
      );

      const { status, body } = await ask(twin, 'forecast');
      touch(dir, 'release');

      expect(status).toBe(409);
      expect(body).toEqual({ status: 'save script running' });
      expect(await done).toBe(200);
    },
    TIMEOUT,
  );

  it('Should refuse a what-if whose save script runs as another account', async () => {
    const twin = await start('save-ward');
    const user = { account: { name: 'dt-script' } } as unknown as ScriptUser;
    jest.spyOn(twin.get(Config), 'getScriptUser').mockReturnValue(user);

    const { status, body } = await ask(twin, 'forecast');

    expect(status).toBe(409);
    expect(body).toMatchObject({ status: 'save script of another account' });
    expect(copies()).toEqual([]);
  });

  it(
    'Should give an absolute copy with a relative runner.yaml and directory',
    async () => {
      dir = whatIfTwin('save-ward');
      const file = relative(process.cwd(), join(dir, 'runner.yaml'));
      app = await startStoredRunner(file);
      controlAccess(app);

      const { body } = await call(app, client, [
        'post',
        '/whatif',
        { name: 'forecast', input: {} },
      ]);
      await ended(app, body.id);

      const env = readFileSync(join(dir, 'env'), 'utf8');
      const [, copy] = /^DT_WHATIF_DIR=(.*)$/m.exec(env) ?? [];
      expect(isAbsolute(copy)).toBe(true);
      expect(copy.startsWith(join(dir, 'snapshots', 'what-if'))).toBe(true);
    },
    TIMEOUT,
  );
});
