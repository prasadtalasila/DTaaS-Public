import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from '@jest/globals';
import type { TimelineRow } from 'src/dto/timeline.dto';
import {
  isInput,
  readRows,
  rowInput,
  rowInputs,
  stepInputs,
} from 'src/tools/inputs';
import { newDir, Row, writeDb } from './tools.fixture';

const roles = new Map([
  ['alice', 'client'],
  ['feed', 'sensor'],
  ['manager-1', 'manager'],
]);

const row = (
  seq: number,
  kind: string,
  data: object,
  by: string | null = null,
) =>
  ({
    seq,
    time: `2026-11-24T10:00:0${seq}.000Z`,
    kind,
    by,
    data,
  }) as TimelineRow;

describe('The inputs of a replay', () => {
  const dir = newDir();

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('Should take what entered the twin, and not what a script raised', () => {
    const sent = [
      row(1, 'transition', { state: 'open' }, 'alice'),
      row(2, 'event', { event: 'close', source: 'client' }, 'alice'),
      row(3, 'command', { name: 'admit', input: { bed: 1 } }, 'manager-1'),
      row(4, 'parameters', { scope: 'multi' }, 'manager-1'),
      row(5, 'peers', { 'dt-2': false }, 'alice'),
      row(6, 'properties', { beds: 2 }, 'feed'),
      row(7, 'notice', { peer: 'dt-2', kind: 'presence', data: null }),
    ];
    const kept = [
      row(8, 'event', { event: 'full', source: 'script' }, 'script'),
      row(9, 'event', { event: 'down', source: 'peer', peer: 'dt-2' }),
      row(10, 'properties', { beds: 1 }, 'script'),
      row(11, 'properties', { beds: 1 }, null),
      ...[
        'entry',
        'exit',
        'sent',
        'whatif',
        'snapshot',
        'start',
        'stop',
        'shutdown',
      ].map((kind, index) => row(12 + index, kind, {})),
    ];

    expect(sent.every((each) => isInput(each, roles))).toBe(true);
    expect(kept.filter((each) => isInput(each, roles))).toEqual([]);
  });

  it('Should send each row as its route takes it', () => {
    const inputs = [
      row(1, 'transition', { state: 'open', reply: {} }, 'alice'),
      row(2, 'event', { event: 'close', source: 'client' }, 'alice'),
      row(3, 'command', { name: 'admit', input: { bed: 1 }, run: 4 }, 'alice'),
      row(4, 'command', { name: 'open', run: 5 }, 'alice'),
      row(9, 'command', { name: 'open', run: 5, stored: true }, 'alice'),
      row(5, 'parameters', { scope: 'multi' }, 'alice'),
      row(6, 'notice', { peer: 'dt-2', kind: 'state', data: { a: 1 } }),
      row(7, 'properties', { beds: 2 }, 'feed'),
      row(8, 'peers', { 'dt-2': true }, 'alice'),
    ].map(rowInput);

    expect(
      inputs.map(({ method, path, body }) => [method, path, body]),
    ).toEqual([
      ['POST', '/fsm/transition', { state: 'open' }],
      ['POST', '/fsm/event', { event: 'close' }],
      ['POST', '/', { name: 'admit', input: { bed: 1 } }],
      ['POST', '/', { name: 'open', input: undefined }],
      ['POST', '/', { name: 'open', input: undefined }],
      ['PUT', '/parameters', { scope: 'multi' }],
      ['PUT', '/peers/dt-2/notice', { kind: 'state', data: { a: 1 } }],
      ['PUT', '/properties', { beds: 2 }],
      ['PUT', '/peers', { 'dt-2': true }],
    ]);
    expect(inputs[0]).toMatchObject({
      by: 'alice',
      seq: 1,
      kind: 'transition',
    });
    expect(JSON.stringify(inputs[3].body)).toBe('{"name":"open"}');
    expect(inputs[3].stored).toBeUndefined();
    expect(inputs[4]).toMatchObject({ seq: 9, stored: 5 });
  });

  it('Should keep the rows up to a seq and before a time', () => {
    const rows = [1, 2, 3, 4].map((seq) =>
      row(seq, 'transition', { state: 's' }),
    );

    expect(rowInputs(rows, roles, { seq: 3 }).map(({ seq }) => seq)).toEqual([
      1, 2, 3,
    ]);
    expect(
      rowInputs(rows, roles, { seq: 4, until: '2026-11-24T10:00:02.000Z' }).map(
        ({ seq }) => seq,
      ),
    ).toEqual([1]);
  });

  it('Should send the steps in the order of their times, before until', () => {
    const steps = [
      { at: '2026-11-24T10:00:02.000Z', parameters: { scope: 'multi' } },
      {
        at: '2026-11-24T10:00:01.000Z',
        notice: { peer: 'dt-2', kind: 'presence' as const, data: null },
      },
      { at: '2026-11-24T10:00:03.000Z', event: 'close' },
    ];

    expect(stepInputs(steps, '2026-11-24T10:00:03.000Z')).toEqual([
      {
        time: steps[1].at,
        kind: 'notice',
        by: null,
        method: 'PUT',
        path: '/peers/dt-2/notice',
        body: { kind: 'presence', data: null },
      },
      {
        time: steps[0].at,
        kind: 'parameters',
        by: null,
        method: 'PUT',
        path: '/parameters',
        body: { scope: 'multi' },
      },
    ]);
    expect(stepInputs(steps)).toHaveLength(3);
  });

  it('Should read the rows of a database after a seq, with the input of a command', () => {
    const file = join(dir, 'state.db');
    const rows: Row[] = [
      { kind: 'start', data: {} },
      {
        kind: 'command',
        data: { name: 'admit', input: { patient: 'p-9' } },
        by: 'alice',
      },
      {
        kind: 'entry',
        data: { state: 'open' },
        at: '2026-11-23T06:00:00.000Z',
        origin: { by: 'alice', seq: 9 },
      },
    ];
    writeDb(file, rows);

    expect(readRows(file, 1)).toEqual([
      expect.objectContaining({
        seq: 2,
        data: { name: 'admit', input: { patient: 'p-9' } },
      }),
      expect.objectContaining({
        seq: 3,
        at: '2026-11-23T06:00:00.000Z',
        origin: { by: 'alice', seq: 9 },
      }),
    ]);
  });
});
