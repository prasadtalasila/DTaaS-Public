import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { TimelineRow } from 'src/dto/timeline.dto';
import ExecaManager from 'src/execa-manager.service';
import { digitalTwin } from './fsm.util';
import {
  alice,
  as,
  gateway,
  listenWithAccess,
  manager,
  settled,
  timeline,
} from './timeline.util';

// raise-event raises done with the token of the scripts
const DEFINITION = `
events: [done, scope-changed]
parameters:
  scope: {type: string, enum: [single, multi], default: single, controllable: true, event: scope-changed}
properties:
  free-beds: {type: integer, minimum: 0, unit: beds}
states:
  create: {transitions: {$success: raise-event}}
  raise-event: {transitions: {done: execute}}
  execute: {transitions: {scope-changed: {state: execute, stop: true}}}
manager:
  commands: [create]`;

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

const pause = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 50);
  });

async function whileStopped(app: INestApplication): Promise<void> {
  if (!app.get(ExecaManager).isRunning('loop')) {
    await pause();
    await whileStopped(app);
  }
}

// A short run: a transition whose scripts raise an event, an event that
// moves nothing, a command with input, a parameter change, a property
// write, and a command that is stopped
async function run(app: INestApplication): Promise<void> {
  const client = as(app, alice);
  await client.post('/fsm/transition', { state: 'create' });
  await settled(app, 'execute');
  await client.post('/fsm/event', { event: 'done' });
  const input = { patient: 'p-7' };
  await client.post('/', { name: 'echo-input', input });
  await as(app, manager).put('/parameters', { scope: 'multi' });
  await settled(app, 'execute');
  await as(app, gateway).put('/properties', { 'free-beds': 4 });
  const loop = client.post('/', { name: 'loop' }).then();
  await whileStopped(app);
  await client.post('/stop', { name: 'loop' });
  await loop;
}

const what = ({ kind, by, data }: TimelineRow) => {
  const source = kind === 'event' ? ` ${data.source}` : '';
  return `${kind} ${by}${source}`;
};

describe('Timeline end-to-end tests', () => {
  let dir: string;
  let app: INestApplication;
  let rows: TimelineRow[];

  beforeAll(async () => {
    dir = digitalTwin(DEFINITION, ['raise-event', 'echo-input', 'loop']);
    app = await listenWithAccess(dir);
    await run(app);
    rows = await timeline(app, alice, '?limit=1000');
  }, TIMEOUT);

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should record the run, in order, with the callers', () => {
    const changes = rows.filter(({ kind }) => kind !== 'sent');
    expect(changes.map(what)).toEqual([
      'start null',
      'transition alice',
      'entry null',
      'exit null',
      'entry null',
      'event script script',
      'entry null',
      'exit null',
      'event alice client',
      'command alice',
      'parameters manager-1',
      'event manager-1 parameter',
      'entry null',
      'exit null',
      'properties ward-gateway',
      'command alice',
      'stop alice',
    ]);
    expect(changes.find(({ kind }) => kind === 'command')?.data).toEqual({
      name: 'echo-input',
      input: { patient: 'p-7' },
      id: 4,
    });
  });

  it('Should page with after', async () => {
    const first = await timeline(app, alice, '?limit=5');
    const rest = await timeline(app, alice, `?after=${first[4].seq}`);

    expect([...first, ...rest]).toEqual(rows);
    expect(await timeline(app, alice, '?count=true')).toEqual({
      count: rows.length,
    });
  });

  it('Should show the input of a command to a client only', async () => {
    const read = await timeline(app, manager, '?kind=command');

    expect(read.map(({ data }) => data)).toEqual([
      { name: 'echo-input', id: 4 },
      { name: 'loop', id: 6 },
    ]);
  });

  it('Should refuse a sensor', async () => {
    const { status } = await as(app, gateway).get('/timeline');

    expect(status).toBe(HttpStatus.FORBIDDEN);
  });

  it.each(['?kind=bogus', '?limit=0', '?after=x', '?since=today'])(
    'Should refuse the query %s',
    async (query) => {
      const reply = await as(app, alice).get(`/timeline${query}`);

      expect(reply.status).toBe(HttpStatus.BAD_REQUEST);
    },
  );
});
