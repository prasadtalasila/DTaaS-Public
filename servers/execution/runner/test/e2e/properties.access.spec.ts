import { rmSync } from 'node:fs';
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
import supertest from 'supertest';
import Access from 'src/auth/access';
import Config from 'src/config/configuration.service';
import { Caller, httpAuthorization, newCaller } from 'test/sign.util';
import { digitalTwin, startRunner } from './fsm.util';

const DEFINITION = `
properties:
  free-beds: {type: integer, minimum: 0, unit: beds}
states: {create: {}}`;

const alice = newCaller('alice');
const manager = newCaller('manager-1');
const gateway = newCaller('ward-gateway');

const PRINCIPALS = [
  { name: 'alice', role: 'client' as const, publicKey: alice.publicKey },
  { name: 'manager-1', role: 'manager' as const, publicKey: manager.publicKey },
  {
    name: 'ward-gateway',
    role: 'sensor' as const,
    publicKey: gateway.publicKey,
  },
];

describe('Runner properties access end-to-end tests', () => {
  let dir: string;
  let app: INestApplication;

  const http = () => supertest(app.getHttpServer());

  // A request that the caller signed for this call
  function signed(
    caller: Caller,
    method: 'GET' | 'PUT',
    path: string,
    body?: string,
  ) {
    const header = httpAuthorization(caller, 'dt-1', { method, path, body });
    const request = method === 'GET' ? http().get(path) : http().put(path);
    request.set('Authorization', header);
    return body === undefined
      ? request
      : request.set('Content-Type', 'application/json').send(body);
  }

  beforeEach(async () => {
    dir = digitalTwin(DEFINITION);
    app = await startRunner(join(dir, 'runner.yaml'));
    const access = new Access(PRINCIPALS, 'dt-1');
    jest.spyOn(app.get<Config>(Config), 'access').mockReturnValue(access);
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should name the principal that wrote a value', async () => {
    const body = JSON.stringify({ 'free-beds': 1 });
    const reply = await signed(gateway, 'PUT', '/properties', body);

    expect(reply.status).toBe(HttpStatus.OK);
    expect(reply.body['free-beds'].by).toBe('ward-gateway');
  });

  it('Should let a manager read the properties, not write them', async () => {
    const read = await signed(manager, 'GET', '/properties');
    const write = await signed(
      manager,
      'PUT',
      '/properties',
      '{"free-beds":1}',
    );

    expect(read.status).toBe(HttpStatus.OK);
    expect([write.status, write.body.message]).toEqual([
      HttpStatus.FORBIDDEN,
      'manager may not call set-properties',
    ]);
  });

  it('Should let a sensor call the property routes and health only', async () => {
    const read = await signed(gateway, 'GET', '/properties');
    const health = await http().get('/health');
    const state = await signed(gateway, 'GET', '/state');
    const parameters = await signed(gateway, 'PUT', '/parameters', '{}');

    expect([read.status, health.status]).toEqual([
      HttpStatus.OK,
      HttpStatus.OK,
    ]);
    expect([state.status, state.body.message]).toEqual([
      HttpStatus.FORBIDDEN,
      'sensor may not call state',
    ]);
    expect(parameters.status).toBe(HttpStatus.FORBIDDEN);
  });
});
