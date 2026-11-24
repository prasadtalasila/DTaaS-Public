import { rmSync } from 'node:fs';
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
import { startTwin, touch, until } from './snapshot.util';
import Webhook from './webhook.util';
import { call, client, controlAccess, whatIfTwin } from './whatif.util';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

describe('The end of a what-if that the twin stopped end-to-end', () => {
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
  });

  afterEach(async () => {
    touch(dir, 'go');
    await app.get(ExecaManager).stop();
    await app.close();
    await webhook.close();
    jest.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const fsm = async () => (await call(app, client, ['get', '/fsm'])).body;

  it(
    'Should tell the stopped end of a what-if that a stop transition stopped',
    async () => {
      const post = (path: string, body: object) =>
        call(app, client, ['post', path, body]);
      await post('/fsm/transition', { state: 'forecast-hold' });
      await until(async () => (await fsm()).status === 'valid');
      const { body } = await post('/whatif', { name: 'forecast-hold' });

      const moved = await post('/fsm/event', { event: 'halt' });
      const notice = await webhook.first(
        (received) => received.body.kind === 'whatif',
      );

      expect(moved.body).toMatchObject({ status: 'accepted', state: 'work' });
      expect(notice.body.data).toEqual({
        id: body.id,
        name: 'forecast-hold',
        status: 'stopped',
        exitCode: null,
        result: '',
      });
    },
    TIMEOUT,
  );
});
