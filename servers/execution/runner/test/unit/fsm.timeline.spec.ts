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
import { Logger } from '@nestjs/common';
import { callerContext } from 'src/auth/caller-context';
import { TimelineRow } from 'src/dto/timeline.dto';
import Timeline from 'src/queue.timeline';
import { createService, MACHINE_FILE, scriptFolder } from './fsm.fixture';
import { allRows, changes, startRunner } from './timeline.fixture';

type Runner = ReturnType<typeof startRunner>;

// Runs the act as the request of the principal would
const as = <T>(by: string, act: () => T): T => callerContext.run({ by }, act);

const FULL = { id: 'hospital-2', machine: { state: 'full', entry: 4 } };

// A day of the hospital: a client starts it, its script completes, a
// manager widens its scope, a full peer sends its patients, a sensor
// counts the beds twice, a client admits and stops, and it shuts down
async function day({ fsm, descriptor, queue, finish }: Runner) {
  as('alice', () => fsm.transition('create'));
  await finish('create');
  as('manager-1', () => fsm.setParameters({ scope: 'multi' }));
  descriptor.peers().observe('hospital-2', 'state', FULL);
  as('alice', () => fsm.event('admit'));
  as('ward-gateway', () => descriptor.properties().set({ 'free-beds': 3 }));
  as('ward-gateway', () => descriptor.properties().set({ 'free-beds': 3 }));
  as('manager-1', () => descriptor.peers().set({ 'hospital-2': false }));
  const input = { patient: 'p-7' };
  as('alice', () =>
    queue.timeline.command({ name: 'admit', input }, undefined, () =>
      queue.enqueue('admit'),
    ),
  );
  as('alice', () => queue.timeline.record('stop', { name: null }));
  descriptor.beforeApplicationShutdown();
}

// What a row says, without its seq and time
const brief = ({ kind, by, data }: TimelineRow) => [kind, by, data];

describe('Timeline of a runner', () => {
  let runner: Runner;

  // the peer events that the day raises are logged
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockReturnValue(undefined);
  });

  afterEach(() => {
    runner.queue.close();
    rmSync(runner.dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('Should write a row of each kind, in order, with cause and caller', async () => {
    runner = startRunner();
    await day(runner);

    const rows = allRows(runner.queue);
    const seq = (kind: string, nth = 0) =>
      rows.filter((row) => row.kind === kind)[nth].seq;
    const reply = (status: string, state: string) => ({
      reply: { status, state },
    });
    expect(changes(rows).slice(1).map(brief)).toEqual([
      [
        'transition',
        'alice',
        { state: 'create', ...reply('accepted', 'create') },
      ],
      ['entry', null, { state: 'create', entry: 1, cause: seq('transition') }],
      [
        'exit',
        null,
        { state: 'create', entry: 1, status: 'valid', command: 1 },
      ],
      ['entry', null, { state: 'open', entry: 2, cause: seq('exit') }],
      ['parameters', 'manager-1', { scope: 'multi' }],
      [
        'event',
        'manager-1',
        {
          event: 'scope-changed',
          source: 'parameter',
          cause: seq('parameters'),
          ...reply('accepted', 'open'),
        },
      ],
      ['entry', null, { state: 'open', entry: 3, cause: seq('event') }],
      ['notice', null, { peer: 'hospital-2', kind: 'state', data: FULL }],
      [
        'event',
        null,
        {
          event: 'neighbour-full',
          source: 'peer',
          peer: 'hospital-2',
          cause: seq('notice'),
          ...reply('accepted', 'full'),
        },
      ],
      ['entry', null, { state: 'full', entry: 4, cause: seq('event', 1) }],
      [
        'event',
        'alice',
        { event: 'admit', source: 'client', ...reply('no transition', 'full') },
      ],
      ['properties', 'ward-gateway', { 'free-beds': 3 }],
      ['peers', 'manager-1', { 'hospital-2': false }],
      ['command', 'alice', { name: 'admit', input: { patient: 'p-7' }, id: 4 }],
      ['stop', 'alice', { name: null }],
      ['shutdown', null, {}],
    ]);
  });

  it('Should name the row that led to each state notification', async () => {
    runner = startRunner();
    await day(runner);

    const rows = allRows(runner.queue);
    const states = rows.filter(
      ({ kind, data }) => kind === 'sent' && data.kind === 'state',
    );
    expect(states.length).toBeGreaterThan(0);
    states.forEach(({ seq, data }) => {
      const cause = rows.find((row) => row.seq === data.cause);
      expect(Object.keys(data)).toEqual(['kind', 'cause']);
      expect(cause?.kind).not.toBe('sent');
      expect(cause?.seq).toBeLessThan(seq);
    });
  });

  it('Should record the other notifications whole', async () => {
    runner = startRunner();
    runner.connect();
    as('alice', () => runner.fsm.escalate({ reason: 'no beds' }));
    await runner.notifier.beforeApplicationShutdown();

    const sent = allRows(runner.queue)
      .filter(({ kind, data }) => kind === 'sent' && data.kind !== 'state')
      .map(({ by, data }) => [by, data.kind, data.data]);
    const online = expect.objectContaining({ online: true });
    expect(sent).toEqual([
      [null, 'presence', online],
      [null, 'presence', online],
      [null, 'escalation', expect.objectContaining({ reason: 'no beds' })],
      [null, 'presence', { online: false }],
    ]);
  });

  it('Should start with the whole state, from which a later one follows', async () => {
    runner = startRunner();
    await day(runner);

    const [start, ...rows] = allRows(runner.queue);
    expect(start).toMatchObject({ kind: 'start', by: null });
    expect(start.data).toEqual({
      class: null,
      instance: { capacity: 30 },
      state: {
        machine: {
          state: null,
          status: 'none',
          entry: 0,
          events: expect.any(Array),
        },
        parameters: { scope: 'single', capacity: 30 },
        properties: { 'free-beds': { value: null, time: null } },
      },
      peers: ['hospital-2'],
    });
    const parameters = rows
      .filter(({ kind }) => kind === 'parameters')
      .reduce((values, { data }) => ({ ...values, ...data }), {
        ...(start.data.state as { parameters: object }).parameters,
      });
    const entries = rows.filter(({ kind }) => kind === 'entry');
    const state = runner.descriptor.state();
    expect(parameters).toEqual(state.parameters);
    expect(entries.at(-1)?.data).toMatchObject({
      state: state.machine?.state,
      entry: state.machine?.entry,
    });
  });
});

describe('Timeline that can not be written', () => {
  it('Should log the failed write, and still answer the request', () => {
    const dir = scriptFolder();
    jest.spyOn(Logger.prototype, 'log').mockReturnValue(undefined);
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockReturnValue(undefined);
    const { service, queue } = createService(join(dir, MACHINE_FILE));
    queue.timeline = new Timeline(() => {
      throw new Error('database is locked');
    });

    expect(as('alice', () => service.transition('create'))).toEqual({
      status: 'accepted',
      state: 'create',
    });
    expect(error).toHaveBeenCalledWith(
      'Could not write the timeline: Error: database is locked',
    );
    rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });
});
