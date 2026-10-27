// The Manager's side of the demo, in one process: a local MQTT broker,
// a subscriber to the runner's notifications and a webhook receiver.
// Each notification becomes one line of run/mqtt.log or run/webhook.log,
// marked verified, UNSIGNED or INVALID by jws.mjs; an INVALID one shows
// why, and its payload as it came.
import { appendFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { text } from 'node:stream/consumers';
import { Aedes } from 'aedes';
import { connectAsync } from 'mqtt';
import { marked } from './jws.mjs';
import summary from './summary.mjs';
import { BASE, BROKER_PORT, WEBHOOK_PORT } from './settings.mjs';

function log(file, line) {
  appendFileSync(`run/${file}`, `${line}\n`);
}

async function startBroker() {
  const aedes = await Aedes.createBroker();
  const server = createServer(aedes.handle);
  server.listen(BROKER_PORT, '127.0.0.1');
  await once(server, 'listening');
}

async function startSubscriber() {
  const client = await connectAsync(`mqtt://127.0.0.1:${BROKER_PORT}`, {
    protocolVersion: 4,
  });
  client.on('message', (topic, payload) => {
    if (payload.length > 0) {
      const name = topic.slice(BASE.length + 1).padEnd(18);
      log('mqtt.log', marked(payload.toString(), name, summary));
    }
  });
  await client.subscribeAsync(`${BASE}/notify/+`, { qos: 1 });
}

async function startWebhook() {
  const server = createHttpServer(async (request, response) => {
    const body = await text(request);
    response.writeHead(204).end();
    const describe = (n) => `${n.kind.padEnd(10)} ${summary(n)}`;
    log('webhook.log', marked(body, 'POST', describe));
  });
  server.listen(WEBHOOK_PORT, '127.0.0.1');
  await once(server, 'listening');
}

await startBroker();
await startSubscriber();
await startWebhook();
console.log(
  `broker mqtt://127.0.0.1:${BROKER_PORT}, subscribed to ${BASE}/notify/+;` +
    ` webhook http://127.0.0.1:${WEBHOOK_PORT}/dt-events`,
);
