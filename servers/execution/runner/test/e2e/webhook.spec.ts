import { EventEmitter, once } from 'node:events';
import { rmSync } from 'node:fs';
import {
  createServer,
  IncomingHttpHeaders,
  IncomingMessage,
  Server,
} from 'node:http';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { HttpStatus, INestApplication } from '@nestjs/common';
import Config from 'src/config/configuration.service';
import { digitalTwin, post, startRunner } from './fsm.util';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

type Post = { headers: IncomingHttpHeaders; body: Record<string, unknown> };

type Machine = { state: string | null; status: string };

// A webhook that records each post and answers 204
class Webhook extends EventEmitter {
  readonly posts: Post[] = [];

  readonly server: Server = createServer((request, response) => {
    void Webhook.read(request).then((body) => {
      response.writeHead(HttpStatus.NO_CONTENT).end();
      const received = { headers: request.headers, body: JSON.parse(body) };
      this.posts.push(received);
      this.emit('post', received);
    });
  });

  private static async read(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    await once(request, 'end');
    return Buffer.concat(chunks).toString();
  }

  async listen(): Promise<string> {
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/dt-events`;
  }

  // The first post, received or to come, whose machine passes the check
  received(check: (machine: Machine | null) => boolean): Promise<Post> {
    const passes = (received: Post) =>
      check((received.body.data as { machine: Machine | null }).machine);
    const earlier = this.posts.find(passes);
    if (earlier !== undefined) {
      return Promise.resolve(earlier);
    }
    return new Promise((resolve) => {
      const listener = (received: Post) => {
        if (passes(received)) {
          this.off('post', listener);
          resolve(received);
        }
      };
      this.on('post', listener);
    });
  }
}

describe('Webhook notifications', () => {
  let dir: string;
  let app: INestApplication;
  let webhook: Webhook;

  beforeEach(async () => {
    webhook = new Webhook();
    const url = await webhook.listen();
    jest
      .spyOn(Config.prototype, 'getNotify')
      .mockReturnValue({ url, token: 'secret' });
    dir = digitalTwin('states: {create: {}}');
    app = await startRunner(join(dir, 'runner.yaml'));
  });

  afterEach(async () => {
    await app.close();
    webhook.server.close();
    await once(webhook.server, 'close');
    rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  }, TIMEOUT);

  it(
    'Should post the state document at startup and after a transition',
    async () => {
      const startup = await webhook.received((machine) => !machine?.state);
      const { status } = await post(app, '/fsm/transition', {
        state: 'create',
      });
      const done = await webhook.received(
        (machine) => machine?.status === 'valid',
      );

      expect([status, startup.headers]).toEqual([
        HttpStatus.ACCEPTED,
        expect.objectContaining({
          'content-type': 'application/json',
          authorization: 'Bearer secret',
        }),
      ]);
      expect(done.body).toMatchObject({
        kind: 'state',
        id: 'dt-1',
        time: (done.body.data as { time: string }).time,
        data: { machine: { state: 'create', status: 'valid', entry: 1 } },
      });
    },
    TIMEOUT,
  );
});
