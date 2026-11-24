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
import { connectAsync, MqttClient } from 'mqtt';
import Config from 'src/config/configuration.service';
import DescriptorService from 'src/descriptor.service';
import ExecaManager from 'src/execa-manager.service';
import { MqttRoute, requestTopic } from 'src/mqtt/mqtt.config';
import MqttService from 'src/mqtt/mqtt.service';
import { nextReply, startBroker, stopBroker } from './mqtt.util';
import { saving, snapshotTwin, startTwin, touch, until } from './snapshot.util';

const TOPIC = 'dtaas/test/runner';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

describe('Runner MQTT snapshots end-to-end tests', () => {
  let client: MqttClient;
  let app: INestApplication;
  let dir: string;
  // whether a save with stop closed the runner already
  let closed: boolean;
  // Undo only what started, so that a failed setup can not keep jest
  // from exiting
  const cleanups: Array<() => Promise<void>> = [];

  // The reply to one request on the route
  async function request(route: MqttRoute, body: unknown): Promise<unknown> {
    const topic = requestTopic(TOPIC, route);
    const reply = nextReply(client, `${topic}/response`);
    const payload = body === undefined ? '' : JSON.stringify(body);
    await client.publishAsync(topic, payload, { qos: 1 });
    return (await reply).body;
  }

  beforeEach(async () => {
    dir = snapshotTwin();
    cleanups.push(() => {
      rmSync(dir, { recursive: true, force: true });
      return Promise.resolve();
    });
    const broker = await startBroker();
    cleanups.push(() => stopBroker(broker));
    client = await connectAsync(broker.url, { protocolVersion: 4 });
    cleanups.push(() => client.endAsync());
    await client.subscribeAsync(`${TOPIC}/#`, { qos: 1 });
    const subscribed = new Promise<void>((resolve) => {
      broker.aedes.on('subscribe', () => resolve());
    });
    app = await startTwin(dir);
    closed = false;
    cleanups.push(async () => {
      touch(dir, 'release');
      if (!closed) {
        await app.get(ExecaManager).stop();
        await app.close();
      }
    });
    const mqtt = { url: broker.url, topic: TOPIC, protocolVersion: 4 as const };
    jest.spyOn(app.get<Config>(Config), 'getMqtt').mockReturnValue(mqtt);
    app.get<MqttService>(MqttService).start();
    await subscribed;
  });

  afterEach(async () => {
    await cleanups
      .splice(0)
      .reverse()
      .reduce((done, cleanup) => done.then(cleanup), Promise.resolve());
  });

  it(
    'Should save on snapshot/set and list on snapshot',
    async () => {
      touch(dir, 'release');

      const saved = await request('save', {});
      const listed = await request('snapshots', undefined);

      expect(saved).toEqual({
        time: expect.any(String),
        seq: expect.any(Number),
        path: expect.stringContaining('snapshots'),
      });
      expect(listed).toEqual([saved]);
    },
    TIMEOUT,
  );

  it(
    'Should answer a change during a save with saving',
    async () => {
      const saved = request('save', {});
      await until(() => saving(app));

      const refused = await request('transition', { state: 'work' });
      const read = await request('health', undefined);
      touch(dir, 'release');

      expect(refused).toEqual({ status: 'saving' });
      expect(read).toMatchObject({ saving: true });
      expect(await saved).toMatchObject({ seq: expect.any(Number) });
    },
    TIMEOUT,
  );

  it(
    'Should answer a save with stop before the runner shuts down',
    async () => {
      touch(dir, 'release');
      const shutdown = new Promise<void>((resolve) => {
        app
          .get(DescriptorService)
          .snapshots()
          .onStop(async () => {
            await app.close();
            closed = true;
            resolve();
          });
      });

      const saved = await request('save', { stop: true });

      expect(closed).toBe(false);
      expect(saved).toMatchObject({ seq: expect.any(Number) });
      await shutdown;
      expect(closed).toBe(true);
    },
    TIMEOUT,
  );
});
