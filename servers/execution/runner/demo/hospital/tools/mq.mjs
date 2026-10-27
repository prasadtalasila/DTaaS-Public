// mq ROUTE [JSON]: publishes a request on <base>/<ROUTE> and prints the
// response that the runner publishes on <base>/<ROUTE>/response. With
// the keys of record.mjs, the request is signed (sign.mjs).
// mq retained: prints the notifications that the broker retained, as a
// Manager that subscribes late receives them.
// Each response and notification is marked verified, UNSIGNED or
// INVALID (jws.mjs); an INVALID one shows why, and its payload as it
// came, unverified.
import { connectAsync } from 'mqtt';
import format from './format.mjs';
import unwrap, { marked } from './jws.mjs';
import { envelope } from './sign.mjs';
import summary from './summary.mjs';
import { BASE, BROKER_PORT } from './settings.mjs';

const TIMEOUT_MS = 20000;

function nextMessage(client, topic) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('no response')),
      TIMEOUT_MS,
    );
    client.on('message', (received, payload) => {
      if (received === topic) {
        clearTimeout(timer);
        resolve(payload.toString());
      }
    });
  });
}

async function request(client, route, payload) {
  const topic = `${BASE}/${route}/response`;
  await client.subscribeAsync(topic, { qos: 1 });
  const response = nextMessage(client, topic);
  await client.publishAsync(`${BASE}/${route}`, envelope(route, payload), {
    qos: 1,
  });
  const { mark, value, reason, unverified } = unwrap(await response);
  const label = reason === undefined ? mark : `${mark}: ${reason}`;
  console.log(`\x1b[2m${topic} (${label})\x1b[0m`);
  const shown = value ?? unverified;
  if (shown !== undefined) {
    console.log(format(shown));
  }
}

async function retained(client) {
  client.on('message', (topic, payload, packet) => {
    const flag = packet.retain ? 'retained' : 'live';
    const name = topic.slice(BASE.length + 1);
    console.log(marked(payload.toString(), `${name} (${flag})`, summary));
  });
  await client.subscribeAsync(`${BASE}/notify/+`, { qos: 1 });
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

const [route, payload = ''] = process.argv.slice(2);
const client = await connectAsync(`mqtt://127.0.0.1:${BROKER_PORT}`, {
  protocolVersion: 4,
});
try {
  if (route === 'retained') {
    await retained(client);
  } else {
    await request(client, route, payload);
  }
} finally {
  await client.endAsync();
}
