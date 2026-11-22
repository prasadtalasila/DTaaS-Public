import { appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { HttpStatus, INestApplication } from '@nestjs/common';
import supertest from 'supertest';
import { digitalTwin, startRunner } from './fsm.util';
import { startStoredRunner } from './util';

const PROPERTIES = `
properties:
  free-beds: {type: integer, minimum: 0, unit: beds}
  ward-status: {type: string, enum: [open, full]}
`;

const DEFINITION = `${PROPERTIES}states: {create: {}}`;

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const UNKNOWN = { value: null, time: null, by: null };

const freeBeds = { type: 'integer', minimum: 0, unit: 'beds' };

const wardStatus = { type: 'string', enum: ['open', 'full'] };

const NO_MACHINE = { status: 'no state machine', state: null };

describe('Runner properties end-to-end tests', () => {
  let dir: string;
  let app: INestApplication;

  const http = () => supertest(app.getHttpServer());

  const put = (body: unknown) =>
    http()
      .put('/properties')
      .send(body as object);

  async function start(definition: string | undefined): Promise<void> {
    dir = digitalTwin(definition);
    app = await startRunner(join(dir, 'runner.yaml'));
  }

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should show the declarations, unknown until the first write', async () => {
    await start(DEFINITION);
    const { status, body } = await http().get('/properties');

    expect([status, body]).toEqual([
      HttpStatus.OK,
      {
        'free-beds': { ...UNKNOWN, ...freeBeds },
        'ward-status': { ...UNKNOWN, ...wardStatus },
      },
    ]);
  });

  it('Should write values and show them in the state document', async () => {
    await start(DEFINITION);
    const reply = await put({ 'free-beds': 1, 'ward-status': 'open' });
    const state = await http().get('/state');

    expect(reply.status).toBe(HttpStatus.OK);
    expect(reply.body['free-beds']).toEqual({
      value: 1,
      time: expect.stringMatching(ISO_TIME),
      by: null,
      ...freeBeds,
    });
    expect(state.body.properties).toEqual({
      'free-beds': { value: 1, time: reply.body['free-beds'].time },
      'ward-status': { value: 'open', time: reply.body['free-beds'].time },
    });
  });

  it('Should list every problem of a body and change nothing', async () => {
    await start(DEFINITION);
    const reply = await put({
      'free-beds': -1,
      'ward-status': 'open',
      colour: 1,
    });
    const { body } = await http().get('/properties');

    expect(reply.status).toBe(HttpStatus.BAD_REQUEST);
    expect(reply.body.message).toEqual([
      expect.stringMatching(/^property free-beds: Too small/),
      'property colour is not declared',
    ]);
    expect(body['ward-status']).toEqual({ ...UNKNOWN, ...wardStatus });
  });

  it.each([[[1]], ['text'], [null]])(
    'Should refuse the body %j, which is no object',
    async (body) => {
      await start(DEFINITION);
      const { status } = await http()
        .put('/properties')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(body));

      expect(status).toBe(HttpStatus.BAD_REQUEST);
    },
  );

  it('Should take null, and nothing from an empty body', async () => {
    await start(DEFINITION);
    await put({ 'free-beds': 1 });
    const cleared = await put({ 'free-beds': null });
    const empty = await put({});

    expect(cleared.body['free-beds'].value).toBeNull();
    expect(empty.status).toBe(HttpStatus.OK);
    expect(empty.body).toEqual(cleared.body);
  });

  it('Should answer 404 without a state machine file', async () => {
    await start(undefined);
    const read = await http().get('/properties');
    const write = await put({ 'free-beds': 1 });
    const state = await http().get('/state');

    expect([read.status, read.body]).toEqual([
      HttpStatus.NOT_FOUND,
      NO_MACHINE,
    ]);
    expect([write.status, write.body]).toEqual([
      HttpStatus.NOT_FOUND,
      NO_MACHINE,
    ]);
    expect(state.body.properties).toEqual({});
  });

  it('Should serve the properties of a file without states', async () => {
    await start(PROPERTIES);
    const reply = await put({ 'free-beds': 2 });
    const fsm = await http().get('/fsm');
    const dt = await http().get('/dt');
    const state = await http().get('/state');

    expect(reply.body['free-beds'].value).toBe(2);
    expect([fsm.status, fsm.body]).toEqual([HttpStatus.NOT_FOUND, NO_MACHINE]);
    expect(dt.body.stateMachine).toBe(false);
    expect(state.body.machine).toBeNull();
    expect(state.body.properties['free-beds'].value).toBe(2);
  });

  it('Should serve the parameters of a file without states', async () => {
    await start(
      'parameters:\n  beds: {type: integer, default: 2, controllable: true}',
    );
    const reply = await http().put('/parameters').send({ beds: 3 });
    const transition = await http()
      .post('/fsm/transition')
      .send({ state: 'create' });

    expect([reply.status, reply.body.beds.value]).toEqual([HttpStatus.OK, 3]);
    expect([transition.status, transition.body]).toEqual([
      HttpStatus.NOT_FOUND,
      NO_MACHINE,
    ]);
  });

  it('Should keep the values and their times across a restart', async () => {
    dir = digitalTwin(DEFINITION);
    appendFileSync(join(dir, 'runner.yaml'), 'database: runner.db\n');
    app = await startStoredRunner(join(dir, 'runner.yaml'));
    const written = await put({ 'free-beds': 1 });
    await app.close();
    app = await startStoredRunner(join(dir, 'runner.yaml'));
    const { body } = await http().get('/properties');

    expect(body['free-beds']).toEqual(written.body['free-beds']);
    expect(body['ward-status'].value).toBeNull();
  });
});
