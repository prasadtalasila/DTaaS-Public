import type { Entry } from './entries.js';
import { commonPairs } from './lcs.js';

// Two entries side by side, either of which may be missing
export type Pair = { a: Entry | null; b: Entry | null; same: boolean };

// An entry that an input caused, and the entries after it that none
// did; key is the seq of that input in the twin, 0 before the first
type Block = { key: number; entries: Entry[] };

function blocks(entries: Entry[]): Block[] {
  const found: Block[] = [{ key: 0, entries: [] }];
  entries.forEach((entry) => {
    if (entry.key !== null) {
      found.push({ key: entry.key, entries: [] });
    }
    found[found.length - 1].entries.push(entry);
  });
  return found.filter(({ entries: list }) => list.length > 0);
}

// The same state, entered for the same cause; never by entry number
export const sameEntry = (a?: Entry, b?: Entry): boolean =>
  !!a &&
  !!b &&
  a.state === b.state &&
  JSON.stringify(a.cause) === JSON.stringify(b.cause);

const pair = (a?: Entry, b?: Entry): Pair => ({
  a: a ?? null,
  b: b ?? null,
  same: sameEntry(a, b),
});

// The entries between two that are the same, side by side in order
const gap = (a: Entry[], b: Entry[]): Pair[] =>
  Array.from({ length: Math.max(a.length, b.length) }, (_, k) =>
    pair(a[k], b[k]),
  );

// The common entries of two blocks on one line each, and the others
// between them, so that one extra entry is one line
function alignBlock(a: Entry[], b: Entry[]): Pair[] {
  const ends: [number, number][] = [[a.length, b.length]];
  const common = [...commonPairs(a, b, sameEntry), ...ends];
  let [i, j] = [0, 0];
  return common.flatMap(([ci, cj]) => {
    const pairs = [...gap(a.slice(i, ci), b.slice(j, cj))];
    if (ci < a.length) {
      pairs.push(pair(a[ci], b[cj]));
    }
    [i, j] = [ci + 1, cj + 1];
    return pairs;
  });
}

const END: Block = { key: Infinity, entries: [] };

// The pairs of the next blocks, the one with the lower key alone
function next(x: Block, y: Block): [Pair[], number, number] {
  const cmp = x.key - y.key;
  if (cmp === 0) {
    return [alignBlock(x.entries, y.entries), 1, 1];
  }
  return cmp < 0 ? [gap(x.entries, []), 1, 0] : [gap([], y.entries), 0, 1];
}

// Lines up the entries of two timelines by the seq of the input that
// caused each in the twin, and between those by state and cause
export function align(a: Entry[], b: Entry[]): Pair[] {
  // each ends with END, which no block passes
  const [ba, bb] = [
    [...blocks(a), END],
    [...blocks(b), END],
  ];
  const pairs: Pair[] = [];
  let [i, j] = [0, 0];
  while (i < ba.length - 1 || j < bb.length - 1) {
    const [found, di, dj] = next(ba[i], bb[j]);
    pairs.push(...found);
    [i, j] = [i + di, j + dj];
  }
  return pairs;
}
