import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, jest } from '@jest/globals';
import { compare } from 'src/tools/compare-run';
import { readEntries } from 'src/tools/entries';
import { fakeSnapshot, newDir, Row, writeDb } from './tools.fixture';

const BEFORE: Row[] = [
  { kind: 'start', data: {} },
  { kind: 'entry', data: { state: 'idle', entry: 1, cause: null } },
];

// The twin: alice opens it at seq 3, its script ends at 5, and alice
// closes it at 7
const TWIN: Row[] = [
  ...BEFORE,
  { kind: 'transition', data: { state: 'open' }, by: 'alice' },
  { kind: 'entry', data: { state: 'open', entry: 2, cause: 3 } },
  { kind: 'exit', data: { state: 'open', entry: 2, status: 'valid', run: 1 } },
  { kind: 'entry', data: { state: 'full', entry: 3, cause: 5 } },
  { kind: 'event', data: { event: 'close', source: 'client' }, by: 'alice' },
  { kind: 'entry', data: { state: 'closed', entry: 4, cause: 7 } },
  { kind: 'transition', data: { state: 'later' }, by: 'alice' },
  { kind: 'entry', data: { state: 'later', entry: 5, cause: 9 } },
];

const at = (minute: number) =>
  `2026-11-22T22:${String(minute).padStart(2, '0')}:00.000Z`;

// The replay twin of the same, from the start at seq 2; the script of
// open ends with the status given
const replayRows = (status: string, next: string): Row[] => [
  ...BEFORE,
  { kind: 'start', data: {}, at: at(0) },
  {
    kind: 'transition',
    data: { state: 'open' },
    by: 'replay',
    origin: { by: 'alice', seq: 3 },
    at: at(10),
  },
  { kind: 'entry', data: { state: 'open', entry: 2, cause: 4 }, at: at(10) },
  {
    kind: 'exit',
    data: { state: 'open', entry: 2, status, run: 1 },
    at: at(20),
  },
  { kind: 'entry', data: { state: next, entry: 3, cause: 6 }, at: at(20) },
  {
    kind: 'event',
    data: { event: 'close', source: 'client' },
    by: 'replay',
    origin: { by: 'alice', seq: 7 },
    at: at(30),
  },
  { kind: 'entry', data: { state: 'closed', entry: 4, cause: 8 }, at: at(30) },
];

const REPLAY = {
  format: 1,
  of: 'dt-1',
  from: { seq: 2 },
  until: { seq: 8 },
  firstStep: null,
};

describe('Comparing two timelines', () => {
  const dir = newDir();
  const inputs = fakeSnapshot(dir, 'inputs', {
    time: at(59),
    seq: 10,
    rows: TWIN,
  });

  const replayOut = (name: string, rows: Row[], extra: object = {}) => {
    const out = join(dir, name);
    mkdirSync(out);
    writeDb(join(out, 'state.db'), rows, [2.5]);
    writeFileSync(
      join(out, 'replay.json'),
      JSON.stringify({ ...REPLAY, ...extra }),
    );
    return out;
  };

  const printed = (run: () => number) => {
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const code = run();
    const text = write.mock.calls.map(([chunk]) => String(chunk)).join('');
    write.mockRestore();
    return { code, text };
  };

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('Should read the state entries, their causes and the cpu of their scripts', () => {
    const out = replayOut('read', replayRows('valid', 'full'));
    const entries = readEntries(join(out, 'state.db'), true, { after: 2 });

    expect(entries.map(({ state, cause, key }) => [state, cause, key])).toEqual(
      [
        ['open', { kind: 'transition', name: 'transition', by: 'alice' }, 3],
        ['full', { kind: 'completion', name: 'valid', by: null }, null],
        ['closed', { kind: 'event', name: 'close', by: 'alice' }, 7],
      ],
    );
    expect(entries[0]).toMatchObject({ at: at(10), cpuSeconds: 2.5 });
    expect(
      readEntries(join(out, 'state.db'), true, { after: 2, skip: 5 }),
    ).toHaveLength(2);
  });

  // the first column is the time of the left timeline, here the twin
  it('Should find a replay with no change the same as its twin', () => {
    const out = replayOut('same', replayRows('valid', 'full'));
    const { code, text } = printed(() => compare(inputs, out, false));

    expect(code).toBe(0);
    expect(text.split('\n')).toEqual([
      `at        dt-1                        dt-1.replay`,
      `10:00:03  open    transition  alice   open    transition  alice`,
      `10:00:05  full    valid               full    valid`,
      `10:00:07  closed  close       alice   closed  close       alice`,
      '',
      'entries: 3 and 3; the same',
      'cpu seconds: 0.0 and 2.5',
      '',
    ]);
  });

  it('Should mark the first difference, by state and cause', () => {
    const out = replayOut('changed', replayRows('invalid', 'failed'));
    const { code, text } = printed(() => compare(inputs, out, false));

    expect(code).toBe(1);
    expect(text).toContain(
      'full    valid               failed  invalid   <- first difference',
    );
    expect(text).toContain('entries: 3 and 3; first difference at 10:00:05');
  });

  it('Should print the same as one JSON document', () => {
    const out = replayOut('json', replayRows('invalid', 'failed').slice(0, 7));
    const { code, text } = printed(() => compare(out, inputs, true));
    const result = JSON.parse(text);

    expect(code).toBe(1);
    expect(result).toMatchObject({
      a: { id: 'dt-1.replay', entries: 2 },
      b: { id: 'dt-1', entries: 3 },
      firstDifference: at(20),
      same: false,
    });
    expect(result.rows[2]).toMatchObject({
      a: null,
      b: { state: 'closed' },
      same: false,
    });
  });

  it('Should compare two snapshots over the whole of their timelines', () => {
    const other = fakeSnapshot(dir, 'other', {
      time: at(59),
      seq: 10,
      rows: TWIN,
    });
    const { code, text } = printed(() => compare(inputs, other, false));

    expect(code).toBe(0);
    expect(text).toContain('entries: 5 and 5; the same');
  });

  it('Should list an entry that one side has not', () => {
    const out = replayOut('short', replayRows('valid', 'full').slice(0, 7));
    const { code, text } = printed(() => compare(inputs, out, false));

    expect(code).toBe(1);
    expect(text).toContain(
      'closed  close       alice   -   <- first difference',
    );
  });

  it('Should refuse a directory that is neither', () => {
    const odd = join(dir, 'odd');
    mkdirSync(odd);
    writeDb(join(odd, 'state.db'), []);

    expect(() => compare(inputs, dir, false)).toThrow(
      'is neither a snapshot nor the out of a replay',
    );
    expect(() => compare(odd, inputs, false)).toThrow('odd is neither');
  });
});
