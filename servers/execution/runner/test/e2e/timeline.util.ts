import { join } from 'node:path';
import { jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import supertest from 'supertest';
import Access from 'src/auth/access';
import Config from 'src/config/configuration.service';
import { TimelineRow } from 'src/dto/timeline.dto';
import FsmService from 'src/fsm/fsm.service';
import { runnerUrl } from 'src/fsm/script-context';
import { Caller, httpAuthorization, newCaller } from 'test/sign.util';
import { startRunner } from './fsm.util';

export const alice = newCaller('alice');
export const manager = newCaller('manager-1');
export const gateway = newCaller('ward-gateway');

const PRINCIPALS = [
  { name: 'alice', role: 'client' as const, publicKey: alice.publicKey },
  { name: 'manager-1', role: 'manager' as const, publicKey: manager.publicKey },
  {
    name: 'ward-gateway',
    role: 'sensor' as const,
    publicKey: gateway.publicKey,
  },
];

// Starts the runner of the folder with the callers listed, and gives
// its scripts the URL and the token as main.ts does
export async function listenWithAccess(dir: string) {
  const app = await startRunner(join(dir, 'runner.yaml'));
  const access = new Access(PRINCIPALS, 'dt-1');
  jest.spyOn(app.get<Config>(Config), 'access').mockReturnValue(access);
  await app.listen(0);
  const fsm = app.get<FsmService>(FsmService);
  fsm.setRunnerApi(runnerUrl(app.getHttpServer()), access.scriptToken);
  return app;
}

type Method = 'GET' | 'POST' | 'PUT';

// A request that the caller signed; the signature covers the path
// without its query
function signed(
  app: INestApplication,
  caller: Caller,
  [method, route, body]: [Method, string, object?],
) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const path = route.split('?')[0];
  const call = { method, path, body: text };
  const header = httpAuthorization(caller, 'dt-1', call);
  const http = supertest(app.getHttpServer());
  const request = { GET: http.get, POST: http.post, PUT: http.put }[method];
  const sent = request.call(http, route).set('Authorization', header);
  return text === undefined
    ? sent
    : sent.set('Content-Type', 'application/json').send(text);
}

// The requests of the caller to the runner
export const as = (app: INestApplication, caller: Caller) => ({
  get: (route: string) => signed(app, caller, ['GET', route]),
  post: (route: string, body: object) =>
    signed(app, caller, ['POST', route, body]),
  put: (route: string, body: object) =>
    signed(app, caller, ['PUT', route, body]),
});

const pause = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 50);
  });

// Waits for the machine to settle in the state
export async function settled(app: INestApplication, state: string) {
  const machine = app.get<FsmService>(FsmService).check();
  if (machine?.state === state && machine.status !== 'running') {
    return;
  }
  await pause();
  await settled(app, state);
}

// The rows that the caller reads with the query
export async function timeline(
  app: INestApplication,
  caller: Caller,
  query = '',
): Promise<TimelineRow[]> {
  const { body } = await as(app, caller).get(`/timeline${query}`);
  return body;
}
