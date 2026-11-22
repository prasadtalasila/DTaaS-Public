import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { connectAsync, MqttClient } from 'mqtt';
import supertest from 'supertest';
import { startBroker, startRunner, stopBroker } from './mqtt.util';

const TOPIC = 'dtaas/test/runner';

const NO_MACHINE = { status: 'no state machine', state: null };

describe('Runner MQTT write topics end-to-end tests', () => {
  let client: MqttClient;
  let app: INestApplication;
  // Undo only what started, so that a failed setup can not keep jest
  // from exiting
  const cleanups: Array<() => Promise<void>> = [];

  // Publishes a request on the topic level and resolves with the reply
  // on its default response topic
  async function reply(level: string, body: unknown): Promise<unknown> {
    const response = `${TOPIC}/${level}/response`;
    const received = new Promise((resolve) => {
      client.on('message', (topic, payload) => {
        if (topic === response) {
          resolve(JSON.parse(payload.toString()));
        }
      });
    });
    await client.publishAsync(`${TOPIC}/${level}`, JSON.stringify(body), {
      qos: 1,
    });
    return received;
  }

  beforeEach(async () => {
    const broker = await startBroker();
    cleanups.push(() => stopBroker(broker));
    client = await connectAsync(broker.url, { protocolVersion: 4 });
    cleanups.push(() => client.endAsync());
    await client.subscribeAsync(`${TOPIC}/#`, { qos: 1 });
    const subscribed = new Promise<void>((resolve) => {
      broker.aedes.on('subscribe', (subscriptions) => {
        if (subscriptions.some(({ topic }) => topic === `${TOPIC}/execute`)) {
          resolve();
        }
      });
    });
    // aedes supports MQTT 3.1.1 only
    app = await startRunner({
      url: broker.url,
      topic: TOPIC,
      protocolVersion: 4,
    });
    cleanups.push(() => app.close());
    await subscribed;
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  it.each(['parameters/set', 'peers/set', 'properties/set'])(
    'answers a write on %s, a level under the read topic',
    async (level) => {
      const read = level.split('/')[0];
      const http = await supertest(app.getHttpServer()).get(`/${read}`);

      expect(await reply(level, {})).toEqual(http.body);
    },
  );

  it.each([
    ['set-parameters', NO_MACHINE],
    ['set-peers', {}],
  ])(
    'still answers a write on %s, the topic of before 0.11',
    async (level, body) => {
      expect(await reply(level, {})).toEqual(body);
    },
  );

  it('has no topic of before 0.11 for the properties, which are new', async () => {
    const old = reply('set-properties', {});
    const current = reply('properties/set', {});
    const first = await Promise.race([
      old.then(() => 'old'),
      current.then(() => 'current'),
    ]);

    expect(first).toBe('current');
  });
});
