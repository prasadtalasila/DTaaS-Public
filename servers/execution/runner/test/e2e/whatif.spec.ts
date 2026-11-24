import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import Config from 'src/config/configuration.service';
import ExecaManager from 'src/execa-manager.service';
import FsmService from 'src/fsm/fsm.service';
import { startTwin, until } from './snapshot.util';
import Webhook from './webhook.util';
import { call, client, controlAccess, ended, whatIfTwin } from './whatif.util';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

const INPUT = { horizon: 'PT2H' };

// The variables of an env file of name=value lines
const variables = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line.includes('='))
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );

describe('What-if inside the twin end-to-end', () => {
  let dir: string;
  let app: INestApplication;
  let webhook: Webhook;

  beforeEach(async () => {
    webhook = new Webhook();
    const url = await webhook.listen();
    jest.spyOn(Config.prototype, 'getNotify').mockReturnValue({ url });
    dir = whatIfTwin();
    app = await startTwin(dir);
    controlAccess(app);
    app.get(FsmService).setRunnerApi('http://127.0.0.1:5000', 'token-1');
  });

  afterEach(async () => {
    await app.get(ExecaManager).stop();
    await app.close();
    await webhook.close();
    jest.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = async (path: string) =>
    (await call(app, client, ['get', path])).body;

  const ask = (name: string, input?: object) =>
    call(app, client, ['post', '/whatif', { name, input }]);

  const copies = () => join(dir, 'snapshots', 'what-if');

  const noCopies = () =>
    Promise.resolve(
      !existsSync(copies()) || readdirSync(copies()).length === 0,
    );

  it(
    'Should run the command on a copy, without an address or a token, and keep what it printed',
    async () => {
      const { status, body } = await ask('forecast', INPUT);
      const run = await ended(app, body.id);
      await until(noCopies);

      expect(status).toBe(202);
      expect(body).toEqual({
        id: expect.any(Number),
        name: 'forecast',
        status: 'running',
      });
      expect(run).toEqual({
        id: body.id,
        name: 'forecast',
        status: 'valid',
        mode: 'what-if',
        receivedAt: expect.any(String),
        finishedAt: expect.any(String),
        by: 'cli',
        exitCode: 0,
        result: { mode: 'what-if', input: INPUT },
        resources: expect.any(Object),
      });
      const env = variables(readFileSync(join(dir, 'env'), 'utf8'));
      expect(env.DT_MODE).toBe('what-if');
      expect(dirname(env.DT_WHATIF_DIR)).toBe(copies());
      expect(basename(env.DT_WHATIF_DIR)).toMatch(/^\d{8}T\d{9}Z$/);
      expect(Object.keys(env).filter((name) => /^runner_/i.test(name))).toEqual(
        [],
      );
    },
    TIMEOUT,
  );

  it(
    'Should give the script the present as four documents and a database that opens',
    async () => {
      const state = await get('/state');
      const { body } = await ask('forecast', INPUT);
      await ended(app, body.id);

      const seen = join(dir, 'seen');
      const read = (file: string) =>
        JSON.parse(readFileSync(join(seen, file), 'utf8'));
      expect(readdirSync(seen).sort()).toEqual([
        'files',
        'parameters.json',
        'peers.json',
        'properties.json',
        'runner.yaml',
        'scripts',
        'snapshot.json',
        'state.db',
        'state.json',
        'ward.fsm.yaml',
      ]);
      expect({ ...read('state.json'), time: 0 }).toEqual({ ...state, time: 0 });
      expect(read('parameters.json')).toEqual(await get('/parameters'));
      expect(read('properties.json')).toEqual(await get('/properties'));
      expect(read('peers.json')).toEqual(await get('/peers'));
      const db = new DatabaseSync(join(seen, 'state.db'));
      const rows = db.prepare("SELECT kind FROM timeline WHERE kind = 'start'");
      expect(rows.all()).toHaveLength(1);
      db.close();
    },
    TIMEOUT,
  );

  it(
    'Should leave the state, the properties and the machine as they were',
    async () => {
      await call(app, client, ['post', '/fsm/transition', { state: 'work' }]);
      await until(async () => (await get('/fsm')).status === 'valid');
      const before = [
        await get('/state'),
        await get('/properties'),
        await get('/fsm'),
      ];
      const { body } = await ask('forecast', INPUT);
      await ended(app, body.id);

      const after = [
        await get('/state'),
        await get('/properties'),
        await get('/fsm'),
      ];
      // the time of the state document is that of the reply
      expect(after.map((reply) => ({ ...reply, time: 0 }))).toEqual(
        before.map((reply) => ({ ...reply, time: 0 })),
      );
    },
    TIMEOUT,
  );

  it(
    'Should tell once that the run ended, and show it in the history and the timeline',
    async () => {
      const { body } = await ask('forecast', INPUT);
      await ended(app, body.id);
      await until(() =>
        Promise.resolve(
          webhook.posts.some((post) => post.body.kind === 'whatif'),
        ),
      );

      const sent = webhook.posts.filter((post) => post.body.kind === 'whatif');
      expect(sent.map((post) => post.body.data)).toEqual([
        {
          id: body.id,
          name: 'forecast',
          status: 'valid',
          exitCode: 0,
          result: { mode: 'what-if', input: INPUT },
        },
      ]);
      const history = await get('/history');
      expect(
        history.find(({ id }: { id: number }) => id === body.id),
      ).toMatchObject({
        mode: 'what-if',
      });
      type Row = { kind: string; data: { kind?: string } };
      const rows: Row[] = await get('/timeline?kind=whatif,sent');
      expect(rows.filter(({ kind }) => kind === 'whatif')).toEqual([
        expect.objectContaining({
          by: 'cli',
          data: { name: 'forecast', input: INPUT, run: body.id },
        }),
      ]);
      const notices = rows.filter(({ data }) => data.kind === 'whatif');
      expect(notices).toEqual([
        expect.objectContaining({
          kind: 'sent',
          data: { kind: 'whatif', data: sent[0].body.data },
        }),
      ]);
    },
    TIMEOUT,
  );

  it(
    'Should take text that is no JSON as the result, and a failure',
    async () => {
      const text = await ended(app, (await ask('forecast-text')).body.id);
      const failed = await ended(app, (await ask('forecast-fail')).body.id);
      await until(noCopies);

      expect(text).toMatchObject({ status: 'valid', result: 'no json' });
      expect(failed).toMatchObject({
        status: 'failed',
        exitCode: 3,
        result: 'partial',
      });
    },
    TIMEOUT,
  );
});
