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
import { startTwin, touch } from './snapshot.util';
import Webhook from './webhook.util';
import { call, client, controlAccess, whatIfTwin } from './whatif.util';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

describe('The end of a stopped what-if end-to-end', () => {
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

  it(
    'Should tell the stopped end of a what-if that POST /stop stopped',
    async () => {
      const post = (path: string, body: object) =>
        call(app, client, ['post', path, body]);
      const { body } = await post('/whatif', { name: 'forecast-slow' });

      const stopped = await post('/stop', { name: 'forecast-slow' });
      const notice = await webhook.first(
        (received) => received.body.kind === 'whatif',
      );

      expect(stopped.body).toEqual({ stopped: ['forecast-slow'] });
      expect(notice.body.data).toEqual({
        id: body.id,
        name: 'forecast-slow',
        status: 'stopped',
        exitCode: null,
        result: '',
      });
    },
    TIMEOUT,
  );
});
