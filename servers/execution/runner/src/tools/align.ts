import type { Entry } from './entries.js';

// Two entries side by side, either of which may be missing
export type Pair = { a: Entry | null; b: Entry | null; same: boolean };

// Where an entry falls: the key of its input, or that of the last
// entry with one before it, and its place after that entry
type Place = [number, number];

function places(entries: Entry[]): Place[] {
  let anchor = 0;
  let after = 0;
  return entries.map(({ key }) => {
    [anchor, after] = key === null ? [anchor, after + 1] : [key, 0];
    return [anchor, after];
  });
}

// After the last entry of a timeline
const END: Place = [Infinity, 0];

const order = (a: Place = END, b: Place = END): number =>
  a[0] - b[0] || a[1] - b[1];

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

// The entry that comes first, or both when they fall at one place
const take = (cmp: number, a?: Entry, b?: Entry): Pair =>
  pair(cmp <= 0 ? a : undefined, cmp >= 0 ? b : undefined);

// Lines up the entries of two timelines by the seq of the input that
// caused each in the twin, and in order between those
export function align(a: Entry[], b: Entry[]): Pair[] {
  const [pa, pb] = [places(a), places(b)];
  const pairs: Pair[] = [];
  let [i, j] = [0, 0];
  while (i < a.length || j < b.length) {
    const cmp = order(pa[i], pb[j]);
    pairs.push(take(cmp, a[i], b[j]));
    i += Number(cmp <= 0);
    j += Number(cmp >= 0);
  }
  return pairs;
}
