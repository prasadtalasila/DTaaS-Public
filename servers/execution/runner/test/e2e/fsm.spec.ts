import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Keyv from 'keyv';
import supertest from 'supertest';
import AppModule from 'src/app.module';
import Config from 'src/config/configuration.service';
import { DEFINITION_FILE } from 'src/fsm/definition';
import FsmService from 'src/fsm/fsm.service';

const SCRIPTS = ['create', 'execute', 'terminate'];

const DEFINITION = `
events: [stop]
states:
  create: {transitions: {$success: execute}}
  execute: {transitions: {stop: terminate}}
  terminate:`;

// A folder with a runner configuration, the scripts in both their
// Linux and Windows versions, and a state machine
function digitalTwin(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runner-fsm-'));
  const config = `port: 5000\nlocation: '.'\ncommands: [${SCRIPTS}]\n`;
  writeFileSync(join(dir, 'runner.yaml'), config);
  writeFileSync(join(dir, DEFINITION_FILE), DEFINITION);
  SCRIPTS.forEach((script) => {
    writeFileSync(join(dir, script), `#!/bin/sh\nprintf ${script}\n`, {
      mode: 0o755,
    });
    writeFileSync(join(dir, `${script}.ps1`), `Write-Output ${script}\n`);
  });
  return dir;
}

async function startRunner(configFile: string): Promise<INestApplication> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication({ logger: false });
  const options = new Keyv();
  await options.set('configFile', configFile);
  await app.get<Config>(Config).loadConfig(options);
  app.get<FsmService>(FsmService).load();
  await app.init();
  return app;
}

const post = (app: INestApplication, route: string, body: object) =>
  supertest(app.getHttpServer()).post(route).send(body);

// Polls the machine until the script of the state has finished
async function settled(app: INestApplication, state: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { body } = await supertest(app.getHttpServer()).get('/fsm');
    if (body.state === state && body.status !== 'running') {
      return body;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  throw new Error(`The machine did not settle in state ${state}`);
}

describe('Runner state machine end-to-end tests', () => {
  let dir: string;
  let app: INestApplication;

  beforeAll(() => {
    dir = digitalTwin();
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(async () => {
    app = await startRunner(join(dir, 'runner.yaml'));
  });

  afterEach(async () => {
    await app.close();
  });

  it('Should run the scripts from state to state', async () => {
    await supertest(app.getHttpServer())
      .get('/fsm')
      .expect(HttpStatus.OK, { state: null, status: 'none', events: ['stop'] });

    await post(app, '/fsm/transition', { state: 'create' }).expect(
      HttpStatus.ACCEPTED,
      { status: 'accepted', state: 'create' },
    );
    expect(await settled(app, 'execute')).toMatchObject({ status: 'valid' });

    await post(app, '/fsm/event', { event: 'stop' }).expect(
      HttpStatus.ACCEPTED,
      { status: 'accepted', state: 'terminate' },
    );
    await settled(app, 'terminate');
    await supertest(app.getHttpServer())
      .get('/history')
      .expect(HttpStatus.OK, [
        { name: 'create' },
        { name: 'execute' },
        { name: 'terminate' },
      ]);
  });

  it('Should refuse an undeclared state and an event without a transition', async () => {
    const state = await post(app, '/fsm/transition', { state: 'configure' });
    const event = await post(app, '/fsm/event', { event: 'stop' });

    expect([state.status, state.body]).toEqual([
      HttpStatus.BAD_REQUEST,
      { status: 'invalid state', state: null },
    ]);
    expect([event.status, event.body]).toEqual([
      HttpStatus.CONFLICT,
      { status: 'no transition', state: null },
    ]);
  });

  it('Should replay the reply to a repeated request key', async () => {
    const request = () =>
      post(app, '/fsm/transition', { state: 'terminate' })
        .set('Idempotency-Key', 'key-1')
        .expect(HttpStatus.ACCEPTED);

    await request();
    await settled(app, 'terminate');
    await request();
    await supertest(app.getHttpServer())
      .get('/history')
      .expect(HttpStatus.OK, [{ name: 'terminate' }]);
  });

  it.each([
    ['/fsm/transition', { name: 'create' }, 'key'],
    ['/fsm/event', { event: 'stop' }, 'k'.repeat(256)],
  ])('Should refuse a malformed request to %s', async (route, body, key) =>
    post(app, route, body)
      .set('Idempotency-Key', key)
      .expect(HttpStatus.BAD_REQUEST, {
        message: 'Validation Failed',
        error: 'Bad Request',
        statusCode: 400,
      }),
  );
});

describe('Runner without a state machine', () => {
  it('Should answer 404 on the state machine routes', async () => {
    const dir = digitalTwin();
    rmSync(join(dir, DEFINITION_FILE));
    const app = await startRunner(join(dir, 'runner.yaml'));
    const reply = { status: 'no state machine', state: null };

    await supertest(app.getHttpServer())
      .get('/fsm')
      .expect(HttpStatus.NOT_FOUND, reply);
    await post(app, '/fsm/event', { event: 'stop' }).expect(
      HttpStatus.NOT_FOUND,
      reply,
    );
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
