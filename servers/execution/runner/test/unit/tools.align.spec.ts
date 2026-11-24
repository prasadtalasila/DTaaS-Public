import { describe, expect, it } from '@jest/globals';
import { align } from 'src/tools/align';
import type { Entry } from 'src/tools/entries';
import { commonPairs } from 'src/tools/lcs';
import { compared, listing } from 'src/tools/listing';

const entry = (state: string, key: number | null = null): Entry => ({
  seq: 0,
  at: '2026-11-22T22:00:00.000Z',
  state,
  cause: { kind: 'none', name: '', by: null },
  key,
  cpuSeconds: null,
});

const states = (a: Entry[], b: Entry[]) =>
  align(a, b).map(({ a: x, b: y, same }) => [x?.state, y?.state, same]);

describe('Lining up entries', () => {
  it('Should pair by the seq of the input, and in order after it', () => {
    const a = [entry('open', 3), entry('full'), entry('closed', 9)];
    const b = [
      entry('open', 3),
      entry('full'),
      entry('extra'),
      entry('late', 12),
    ];

    expect(states(a, b)).toEqual([
      ['open', 'open', true],
      ['full', 'full', true],
      [undefined, 'extra', false],
      ['closed', undefined, false],
      [undefined, 'late', false],
    ]);
  });

  it('Should show one missing entry without a key as one line', () => {
    const a = [entry('open', 3), entry('scope'), entry('full'), entry('open')];
    const b = [entry('open', 3), entry('full'), entry('open')];

    expect(states(a, b)).toEqual([
      ['open', 'open', true],
      ['scope', undefined, false],
      ['full', 'full', true],
      ['open', 'open', true],
    ]);
  });

  it('Should put a changed entry beside the one it replaces', () => {
    const a = [entry('idle'), entry('ok'), entry('done')];
    const b = [entry('idle'), entry('failed'), entry('done')];

    expect(states(a, b)).toEqual([
      ['idle', 'idle', true],
      ['ok', 'failed', false],
      ['done', 'done', true],
    ]);
  });

  it('Should pair nothing of two empty timelines', () => {
    expect(align([], [])).toEqual([]);
  });
});

describe('A longest common subsequence', () => {
  const same = (x: string, y: string) => x === y;

  it('Should find the pairs of indexes in order', () => {
    expect(commonPairs([...'abcbdab'], [...'bdcaba'], same)).toHaveLength(4);
    expect(commonPairs([...'xay'], [...'ab'], same)).toEqual([[1, 0]]);
    expect(commonPairs([], [...'ab'], same)).toEqual([]);
  });
});

describe('The listing of a comparison', () => {
  it('Should make each column as wide as its longest cell', () => {
    const long = {
      ...entry('open'),
      cause: { kind: 'event', name: 'fidelity-changed', by: 'parameter' },
    };
    const a = { dir: 'a', id: 'hospital-1', entries: [long, entry('full')] };
    const b = { dir: 'b', id: 'hospital-1.replay', entries: [long] };
    const lines = listing(compared(a, b, align(a.entries, b.entries))).split(
      '\n',
    );

    expect(lines.slice(0, 3)).toEqual([
      'at        hospital-1                          hospital-1.replay',
      '22:00:00  open  fidelity-changed  parameter   open  fidelity-changed  parameter',
      '22:00:00  full                                -   <- first difference',
    ]);
  });
});
