import type { Pair } from './align.js';
import type { Entry } from './entries.js';

// One timeline of a comparison: its directory, the twin and its entries
export type Side = { dir: string; id: string; entries: Entry[] };

const WIDTH = 33;

const clock = (time: string): string => time.slice(11, 19);

// The state, then what caused it, and who
function cell(entry: Entry | null): string {
  if (entry === null) {
    return '-';
  }
  const { state, cause } = entry;
  return `${state.padEnd(7)} ${cause.name.padEnd(11)} ${cause.by ?? ''}`.trimEnd();
}

const cpu = (side: Side): number =>
  side.entries.reduce((sum, { cpuSeconds }) => sum + (cpuSeconds ?? 0), 0);

const atOf = ({ a, b }: Pair): string => (a ?? b)?.at ?? '';

// The comparison as one document
export function compared(a: Side, b: Side, pairs: Pair[]) {
  const first = pairs.find(({ same }) => !same);
  const side = (s: Side) => ({
    dir: s.dir,
    id: s.id,
    entries: s.entries.length,
    cpuSeconds: cpu(s),
  });
  return {
    a: side(a),
    b: side(b),
    rows: pairs.map((pair) => ({ at: atOf(pair), ...pair })),
    firstDifference: first === undefined ? null : atOf(first),
    same: first === undefined,
  };
}

export type Compared = ReturnType<typeof compared>;

// The comparison as a listing, with the first difference marked
export function listing(result: Compared): string {
  const head = `${'at'.padEnd(10)}${result.a.id.padEnd(WIDTH)}${result.b.id}`;
  const marked = result.rows.findIndex(({ same }) => !same);
  const lines = result.rows.map(({ at, a, b }, index) => {
    const mark = index === marked ? '   <- first difference' : '';
    return `${clock(at).padEnd(10)}${cell(a).padEnd(WIDTH)}${cell(b)}${mark}`;
  });
  const end = result.same
    ? 'the same'
    : `first difference at ${clock(String(result.firstDifference))}`;
  const counts = `entries: ${result.a.entries} and ${result.b.entries}; ${end}`;
  const seconds = `cpu seconds: ${result.a.cpuSeconds.toFixed(1)} and ${result.b.cpuSeconds.toFixed(1)}`;
  return [head, ...lines, '', counts, seconds].join('\n');
}
