import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { httpClaimsSchema, readClaims } from 'src/auth/claims';
import { parseJws, verifyJws } from 'src/auth/jws';
import { publicKeyObject } from 'src/auth/auth.config';
import Signer from 'src/auth/signer';
import type { Input } from 'src/tools/inputs';
import { newKeyPair } from 'src/tools/replay-config';
import {
  firstStep,
  sendAll,
  sendInput,
  setProperties,
  settle,
} from 'src/tools/send';
import { gap, isoOf, timeSchema } from 'src/tools/times';
import TwinClient from 'src/tools/twin-client';

// What the fake replay twin received
type Received = {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
  when: number;
};

const FROM = '2026-11-22T22:00:00.000Z';

const input = (seconds: number, extra: Partial<Input> = {}): Input => ({
  time: new Date(Date.parse(FROM) + seconds * 1000).toISOString(),
  kind: 'event',
  by: 'alice',
  seq: 400 + seconds,
  method: 'POST',
  path: '/fsm/event',
  body: { event: 'close' },
  ...extra,
});

describe('Sending the inputs to a replay twin', () => {
  const received: Received[] = [];
  const keys = newKeyPair();
  let server: Server;
  let client: TwinClient;
  // the status and the body of each reply, by path
  const replies = new Map<string, [number, unknown]>();

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        const { method = '', url = '', headers } = request;
        received.push({ method, url, headers, body, when: Date.now() });
        const [status, reply] = replies.get(url.split('?')[0]) ?? [200, {}];
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(reply));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    client = new TwinClient(
      `http://127.0.0.1:${port}`,
      'dt-1.replay',
      new Signer(keys.privateKey, 'replay'),
    );
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  const last = () => received[received.length - 1];

  it('Should sign each request as replay, bound to it', async () => {
    await client.call({
      method: 'PUT',
      path: '/parameters?x=1',
      body: { scope: 'multi' },
    });
    const { headers, body } = last();
    const jws = parseJws(String(headers.authorization).replace('Bearer ', ''));
    const kid = verifyJws(jws, () => publicKeyObject(keys.publicKey));
    const now = Math.floor(Date.now() / 1000);
    const claims = readClaims(httpClaimsSchema, jws.payload, {
      aud: 'dt-1.replay',
      now,
    });

    expect(kid).toBe('replay');
    expect(claims).toMatchObject({ htm: 'PUT', htu: '/parameters' });
    expect(JSON.parse(body)).toEqual({ scope: 'multi' });
    expect(headers['content-type']).toBe('application/json');
  });

  it('Should name the caller and the seq of a row, and nothing for a step', async () => {
    expect(await sendInput(client, input(1))).toBe(false);
    expect(last().headers).toMatchObject({
      'replay-by': 'alice',
      'replay-seq': '401',
    });

    await sendInput(client, input(2, { by: null }));
    expect(last().headers['replay-by']).toBeUndefined();
    expect(last().headers['replay-seq']).toBe('402');

    await sendInput(client, input(3, { seq: undefined }));
    expect(last().headers['replay-seq']).toBeUndefined();
  });

  it('Should count a 4xx as refused, and end on a 5xx', async () => {
    replies.set('/refused', [400, { message: 'no' }]);
    replies.set('/failed', [500, { message: 'down' }]);

    expect(await sendInput(client, input(1, { path: '/refused' }))).toBe(true);
    await expect(
      sendInput(client, input(1, { path: '/failed' })),
    ).rejects.toMatchObject({
      code: 1,
      message: expect.stringContaining('500'),
    });
  });

  it('Should keep the gaps of the twin over the speed', async () => {
    const before = received.length;
    const begin = Date.now();
    const counts = await sendAll(
      client,
      [input(0), input(2, { path: '/refused' }), input(6)],
      {
        from: FROM,
        speed: 20,
      },
    );
    const offsets = received.slice(before).map(({ when }) => when - begin);

    expect(counts).toEqual({ sent: 3, refused: 1 });
    expect(offsets[0]).toBeLessThan(50);
    expect(offsets[1]).toBeGreaterThanOrEqual(95);
    expect(offsets[1]).toBeLessThan(200);
    expect(offsets[2]).toBeGreaterThanOrEqual(295);
    expect(offsets[2]).toBeLessThan(400);
  });

  it('Should enter the saved state again only when its script was running', async () => {
    replies.set('/timeline', [200, [{ seq: 12 }]]);
    const manifest = {
      format: 1 as const,
      id: 'dt-1',
      class: null,
      time: FROM,
      seq: 10,
    };
    const running = { state: 'work', status: 'running' };

    expect(
      await firstStep(client, {
        ...manifest,
        machine: { ...running, status: 'valid' },
      }),
    ).toBeNull();
    expect(await firstStep(client, { ...manifest, machine: null })).toBeNull();
    expect(await firstStep(client, { ...manifest, machine: running })).toBe(12);
    replies.set('/timeline', [200, []]);
    await expect(
      firstStep(client, { ...manifest, machine: running }),
    ).rejects.toMatchObject({
      code: 1,
      message: 'The replay twin recorded no entry for the first step',
    });
    replies.set('/timeline', [200, [{ seq: 12 }]]);
    await firstStep(client, { ...manifest, machine: running });
    expect(
      received.slice(-2).map(({ method, url }) => `${method} ${url}`),
    ).toEqual([
      'POST /fsm/transition',
      'GET /timeline?after=10&kind=entry&limit=1',
    ]);
  });

  it('Should write set.properties, and stop when the twin refuses them', async () => {
    const before = received.length;
    await setProperties(client);
    replies.set('/properties', [400, { message: 'unknown property' }]);

    expect(received).toHaveLength(before);
    await expect(setProperties(client, { beds: 2 })).rejects.toMatchObject({
      code: 1,
      message: expect.stringContaining('refused PUT /properties: 400'),
    });
  });

  it('Should wait until no script runs, for the time given at most', async () => {
    replies.set('/fsm', [200, { status: 'valid' }]);
    expect(await settle(client, 1)).toBe(true);

    replies.set('/fsm', [200, { status: 'running' }]);
    expect(await settle(client, 0.2)).toBe(false);
  });

  it('Should end the replay when the twin can not be reached', async () => {
    const lost = new TwinClient(
      'http://127.0.0.1:1',
      'dt-1.replay',
      new Signer(keys.privateKey, 'replay'),
    );

    await expect(
      lost.call({ method: 'GET', path: '/fsm' }),
    ).rejects.toMatchObject({ code: 1 });
  });
});

describe('The times of a replay', () => {
  it('Should read a time in the form of the names of snapshots', () => {
    expect(isoOf('20261123T060000000Z')).toBe('2026-11-23T06:00:00.000Z');
    expect(timeSchema.parse('20261123T060000120Z')).toBe(
      '2026-11-23T06:00:00.120Z',
    );
    expect(timeSchema.safeParse('20261131T060000000Z').success).toBe(false);
    expect(timeSchema.safeParse('2026-11-23T06:00:00.000Z').success).toBe(
      false,
    );
  });

  it('Should divide a gap by the speed, and never wait for the past', () => {
    expect(gap(FROM, '2026-11-22T23:00:00.000Z', 60)).toBe(60000);
    expect(gap(FROM, '2026-11-22T21:00:00.000Z', 1)).toBe(0);
  });
});
