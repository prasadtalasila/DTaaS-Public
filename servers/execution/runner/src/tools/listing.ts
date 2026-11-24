import type { Pair } from './align.js';
import type { Entry } from './entries.js';

// One timeline of a comparison: its directory, the twin and its entries
export type Side = { dir: string; id: string; entries: Entry[] };

const clock = (time: string): string => time.slice(11, 19);

// The widths of the state and of the cause, the longest of both sides
type Widths = { state: number; name: number };

type Row = { a: Entry | null; b: Entry | null };

function widthsOf(rows: Row[]): Widths {
  const entries = rows.flatMap(({ a, b }) => [a, b]).filter((e) => e !== null);
  const longest = (lengths: number[]) => Math.max(0, ...lengths);
  return {
    state: longest(entries.map(({ state }) => state.length)),
    name: longest(entries.map(({ cause }) => cause.name.length)),
  };
}

// The state, then what caused it, and who
function cell(entry: Entry | null, widths: Widths): string {
  if (entry === null) {
    return '-';
  }
  const { state, cause } = entry;
  const named = cause.name.padEnd(widths.name);
  return `${state.padEnd(widths.state)}  ${named}  ${cause.by ?? ''}`.trimEnd();
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

// The rows, each side as wide as its longest cell
function table(result: Compared): string[] {
  const widths = widthsOf(result.rows);
  const cells = result.rows.map(({ a, b }) => [
    cell(a, widths),
    cell(b, widths),
  ]);
  const width =
    Math.max(result.a.id.length, ...cells.map(([a]) => a.length)) + 3;
  const marked = result.rows.findIndex(({ same }) => !same);
  const lines = result.rows.map(({ at }, index) => {
    const mark = index === marked ? '   <- first difference' : '';
    const [a, b] = cells[index];
    return `${clock(at).padEnd(10)}${a.padEnd(width)}${b}${mark}`;
  });
  return [
    `${'at'.padEnd(10)}${result.a.id.padEnd(width)}${result.b.id}`,
    ...lines,
  ];
}

// The comparison as a listing, with the first difference marked
export function listing(result: Compared): string {
  const end = result.same
    ? 'the same'
    : `first difference at ${clock(String(result.firstDifference))}`;
  const counts = `entries: ${result.a.entries} and ${result.b.entries}; ${end}`;
  const seconds = `cpu seconds: ${result.a.cpuSeconds.toFixed(1)} and ${result.b.cpuSeconds.toFixed(1)}`;
  return [...table(result), '', counts, seconds].join('\n');
}
