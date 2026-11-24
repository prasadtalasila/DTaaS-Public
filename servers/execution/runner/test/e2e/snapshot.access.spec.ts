import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import Access from 'src/auth/access';
import Config from 'src/config/configuration.service';
import { Caller, httpAuthorization, newCaller } from 'test/sign.util';
import { http, snapshotTwin, startTwin, touch } from './snapshot.util';

const operator = newCaller('ops');
const manager = newCaller('manager-1');

const PRINCIPALS = [
  { name: 'ops', role: 'operator' as const, publicKey: operator.publicKey },
  { name: 'manager-1', role: 'manager' as const, publicKey: manager.publicKey },
];

type Method = 'get' | 'post' | 'delete';

// A request that the caller signed
function call(
  app: INestApplication,
  caller: Caller,
  [method, path, body]: [Method, string, object?],
) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  // the signature covers the path without its query
  const signed = {
    method: method.toUpperCase(),
    path: path.split('?')[0],
    body: text,
  };
  const request = http(app)
    [method](path)
    .set('Authorization', httpAuthorization(caller, 'dt-1', signed));
  return text === undefined
    ? request
    : request.set('Content-Type', 'application/json').send(text);
}

describe('Roles of snapshots end-to-end', () => {
  let dir: string;
  let app: INestApplication;

  beforeAll(async () => {
    dir = snapshotTwin();
    touch(dir, 'release');
    app = await startTwin(dir);
    const access = new Access(PRINCIPALS, 'dt-1');
    jest.spyOn(app.get<Config>(Config), 'access').mockReturnValue(access);
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['post', '/snapshot', 'save', {}],
    ['get', '/snapshot', 'snapshots', undefined],
    ['delete', '/snapshot/20261123T101502120Z', 'delete-snapshot', undefined],
  ] as const)(
    'Should refuse a manager the %s of %s',
    async (method, path, route, body) => {
      const { status, body: reply } = await call(app, manager, [
        method,
        path,
        body,
      ]);

      expect(status).toBe(403);
      expect(reply.message).toBe(`manager may not call ${route}`);
    },
  );

  it('Should let an operator save, list and remove a snapshot', async () => {
    const saved = await call(app, operator, ['post', '/snapshot', {}]);
    const name = saved.body.path.slice('snapshots/'.length);
    const listed = await call(app, operator, ['get', '/snapshot']);
    const removed = await call(app, operator, ['delete', `/snapshot/${name}`]);
    const timeline = await call(app, operator, [
      'get',
      `/timeline?after=${saved.body.seq}&kind=snapshot`,
    ]);

    expect(saved.status).toBe(201);
    expect(listed.body).toEqual([saved.body]);
    expect(removed.status).toBe(204);
    expect(timeline.body[0]).toMatchObject({ kind: 'snapshot', by: 'ops' });
  });

  it('Should let an operator stop the scripts', async () => {
    const { status } = await call(app, operator, ['post', '/stop', {}]);

    expect(status).toBe(200);
  });

  it('Should not let an operator steer the twin', async () => {
    const { status, body } = await call(app, operator, [
      'post',
      '/fsm/transition',
      { state: 'work' },
    ]);

    expect(status).toBe(403);
    expect(body.message).toBe('operator may not call transition');
  });
});
