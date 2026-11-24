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
import { TimelineRow } from 'src/dto/timeline.dto';
import Timeline from 'src/queue.timeline';
import { createService, MACHINE_FILE, scriptFolder } from './fsm.fixture';
import {
  allRows,
  as,
  changes,
  day,
  FULL,
  settle,
  startRunner,
} from './timeline.fixture';

type Runner = ReturnType<typeof startRunner>;

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
      ['exit', null, { state: 'create', entry: 1, status: 'valid', run: 1 }],
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
      ['exit', null, { state: 'open', entry: 2, status: 'stopped', run: 2 }],
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
      ['exit', null, { state: 'open', entry: 3, status: 'valid', run: 3 }],
      ['exit', null, { state: 'full', entry: 4, status: 'stopped', run: 4 }],
      [
        'event',
        'alice',
        { event: 'admit', source: 'client', ...reply('no transition', 'full') },
      ],
      ['properties', 'ward-gateway', { 'free-beds': 3 }],
      ['peers', 'manager-1', { 'hospital-2': false }],
      [
        'command',
        'alice',
        { name: 'admit', input: { patient: 'p-7' }, run: 5 },
      ],
      ['stop', 'alice', { name: null }],
      ['shutdown', null, {}],
    ]);
  });

  it('Should follow each entry with one exit, also when never started', async () => {
    runner = startRunner();
    as('alice', () => runner.fsm.transition('create'));
    await runner.finish('create');
    // scope-changed stops open, and the next script waits for that stop,
    // which ends after the shutdown began
    runner.fsm.setParameters({ scope: 'multi' });
    runner.fsm.beforeApplicationShutdown();
    await settle();

    const rows = allRows(runner.queue);
    const entries = rows.filter(({ kind }) => kind === 'entry');
    const exits = rows.filter(({ kind }) => kind === 'exit');
    expect(exits.map(({ data }) => data.entry)).toEqual(
      entries.map(({ data }) => data.entry),
    );
    expect(exits.map(({ data }) => [data.status, data.run])).toEqual([
      ['valid', 1],
      ['stopped', 2],
      ['stopped', null],
    ]);
  });

  it('Should end each entry of the day once', async () => {
    runner = startRunner();
    await day(runner);

    const rows = allRows(runner.queue);
    const ended = rows
      .filter(({ kind }) => kind === 'exit')
      .map(({ data }) => data.entry);
    const entered = rows
      .filter(({ kind }) => kind === 'entry')
      .map(({ data }) => data.entry);
    expect([...ended].sort((a, b) => Number(a) - Number(b))).toEqual(entered);
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
