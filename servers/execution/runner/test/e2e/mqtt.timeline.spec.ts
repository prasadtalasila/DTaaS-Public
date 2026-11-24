import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import supertest from 'supertest';
import { connectAsync, MqttClient } from 'mqtt';
import { MqttRoute, requestTopic } from 'src/mqtt/mqtt.config';
import { nextReply, startBroker, startRunner, stopBroker } from './mqtt.util';

const TOPIC = 'dtaas/test/runner';

describe('Runner MQTT timeline end-to-end tests', () => {
  let client: MqttClient;
  let app: INestApplication;
  // Undo only what started, so that a failed setup can not keep jest
  // from exiting
  const cleanups: Array<() => Promise<void>> = [];

  // The reply to one request on the route
  async function request(route: MqttRoute, body: unknown): Promise<unknown> {
    const topic = requestTopic(TOPIC, route);
    const reply = nextReply(client, `${topic}/response`);
    await client.publishAsync(topic, JSON.stringify(body), { qos: 1 });
    return (await reply).body;
  }

  const http = async (query: string) =>
    (await supertest(app.getHttpServer()).get(`/timeline${query}`)).body;

  beforeEach(async () => {
    const broker = await startBroker();
    cleanups.push(() => stopBroker(broker));
    client = await connectAsync(broker.url, { protocolVersion: 4 });
    cleanups.push(() => client.endAsync());
    await client.subscribeAsync(`${TOPIC}/+/response`, { qos: 1 });
    const runnerSubscribed = new Promise<void>((resolve) => {
      broker.aedes.on('subscribe', (subscriptions) => {
        if (subscriptions.some(({ topic }) => topic === `${TOPIC}/timeline`)) {
          resolve();
        }
      });
    });
    app = await startRunner({
      url: broker.url,
      topic: TOPIC,
      protocolVersion: 4,
    });
    cleanups.push(() => app.close());
    await runnerSubscribed;
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  it('Should record a command of MQTT, and answer the rows as HTTP does', async () => {
    const input = { ward: 'B' };
    await request('execute', { name: 'echo-input', input });

    const rows = await request('timeline', { kind: 'command' });
    expect(rows).toEqual([
      {
        seq: expect.any(Number),
        time: expect.any(String),
        kind: 'command',
        by: null,
        data: { name: 'echo-input', input, run: 1 },
      },
    ]);
    expect(rows).toEqual(await http('?kind=command'));
    expect(await request('timeline', { count: 'true' })).toEqual(
      await http('?count=true'),
    );
  });

  it('Should refuse a bad query as HTTP does', async () => {
    expect(await request('timeline', { kind: 'bogus' })).toEqual(
      await http('?kind=bogus'),
    );
  });
});
