import { DatabaseSync } from 'node:sqlite';
import type { TimelineRow } from '../dto/timeline.dto.js';
import Timeline from '../queue.timeline.js';

// What caused an entry: a transition or an event, and who sent it, or
// the end of a script, by its status
export type Cause = { kind: string; name: string; by: string | null };

// A state entry of a timeline; key is the seq that its input had in the
// twin, null when no input caused it or none is known
export type Entry = {
  seq: number;
  at: string;
  state: string;
  cause: Cause;
  key: number | null;
  cpuSeconds: number | null;
};

// Which entries to read: after a seq, up to another, without one
export type Range = {
  after: number;
  upTo?: number | null;
  skip?: number | null;
};

// A replay twin records who sent an input to the twin as its origin
const who = (row: TimelineRow): string | null =>
  row.origin === undefined ? row.by : row.origin.by;

const CAUSES: Record<string, (row: TimelineRow) => Cause> = {
  transition: (row) => ({
    kind: 'transition',
    name: 'transition',
    by: who(row),
  }),
  event: (row) => ({
    kind: 'event',
    name: String(row.data.event),
    by: row.data.source === 'client' ? who(row) : String(row.data.source),
  }),
  exit: (row) => ({
    kind: 'completion',
    name: String(row.data.status),
    by: null,
  }),
};

const NONE: Cause = { kind: 'none', name: '', by: null };

const causeOf = (row?: TimelineRow): Cause =>
  (row && CAUSES[row.kind]?.(row)) ?? NONE;

// An input sent from outside: a transition, or an event of a client
const INPUTS: Record<string, (row: TimelineRow) => boolean> = {
  transition: () => true,
  event: (row) => row.data.source === 'client',
};

const isInput = (row?: TimelineRow): row is TimelineRow =>
  row !== undefined && (INPUTS[row.kind]?.(row) ?? false);

const originSeq = (row: TimelineRow): number | null => row.origin?.seq ?? null;

// The seq of the input in the twin: its own in a twin, its origin in a
// replay twin
function keyOf(row: TimelineRow | undefined, replay: boolean): number | null {
  if (!isInput(row)) {
    return null;
  }
  return replay ? originSeq(row) : row.seq;
}

const CPU = 'SELECT cpu_seconds AS cpu FROM commands WHERE id = ?';

// The cpu seconds of the run of a script, null when not measured
function cpuOf(db: DatabaseSync, run: unknown): number | null {
  if (typeof run !== 'number') {
    return null;
  }
  return (db.prepare(CPU).get(run)?.cpu ?? null) as number | null;
}

type Read = { rows: TimelineRow[]; db: DatabaseSync; replay: boolean };

// The rows of a timeline by seq, and its exits by entry number
const indexes = (rows: TimelineRow[]) => ({
  bySeq: new Map(rows.map((row) => [row.seq, row])),
  exits: new Map(
    rows
      .filter(({ kind }) => kind === 'exit')
      .map((row) => [row.data.entry, row]),
  ),
});

function entriesOf({ rows, db, replay }: Read, range: Range): Entry[] {
  const { bySeq, exits } = indexes(rows);
  const inRange = ({ seq, kind }: TimelineRow) =>
    kind === 'entry' && seq > range.after && seq <= (range.upTo ?? Infinity);
  const toEntry = (row: TimelineRow): Entry => {
    const cause = bySeq.get(Number(row.data.cause));
    const run = exits.get(row.data.entry)?.data.run;
    const [seq, at, state] = [
      row.seq,
      row.at ?? row.time,
      String(row.data.state),
    ];
    return {
      seq,
      at,
      state,
      cause: causeOf(cause),
      key: keyOf(cause, replay),
      cpuSeconds: cpuOf(db, run),
    };
  };
  return rows
    .filter((row) => inRange(row) && row.seq !== range.skip)
    .map(toEntry);
}

// The state entries of the timeline in the database, oldest first
export function readEntries(
  file: string,
  replay: boolean,
  range: Range,
): Entry[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const query = { after: 0, limit: Number.MAX_SAFE_INTEGER, count: false };
    const rows = new Timeline(() => db).rows(query);
    return entriesOf({ rows, db, replay }, range);
  } finally {
    db.close();
  }
}
