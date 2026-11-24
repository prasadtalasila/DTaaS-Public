import { DatabaseSync } from 'node:sqlite';
import { Logger } from '@nestjs/common';
import { currentCaller } from './auth/caller-context.js';
import { originOf, stamps } from './replay/stamp.js';
import type {
  TimelineKind,
  TimelineQuery,
  TimelineRow,
} from './dto/timeline.dto.js';

// One row for each thing that entered the DT, changed in it or left it.
// The table only grows: a row is written once, and a request row is
// completed with its reply, or a command row with its run, in the step
// that wrote it.
export const TIMELINE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS timeline (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT NOT NULL,
    kind TEXT NOT NULL,
    by TEXT,
    data TEXT NOT NULL,
    at TEXT,
    origin TEXT
  )`;

const INSERT = `INSERT INTO timeline (time, kind, by, data, at, origin)
  VALUES (?, ?, ?, ?, ?, ?)`;

// json_set, as json_patch would drop a key whose value is null
const COMPLETE = `UPDATE timeline SET data = json_set(data, '$.' || ?, json(?))
  WHERE seq = ?`;

// The kinds are bound as one text, ",event,entry,", as SQLite binds no
// list
const WHERE = `WHERE seq > :after
  AND (:since IS NULL OR time >= :since)
  AND (:until IS NULL OR time < :until)
  AND (:kinds IS NULL OR instr(:kinds, ',' || kind || ',') > 0)`;

const ROWS = `SELECT seq, time, kind, by, data, at, origin FROM timeline ${WHERE}
  ORDER BY seq LIMIT :limit`;

const COUNT = `SELECT COUNT(*) AS count FROM timeline ${WHERE}`;

const LAST_SEQ = 'SELECT MAX(seq) AS seq FROM timeline';

type Data = Record<string, unknown>;

const bound = ({ after, since, until, kind }: TimelineQuery) => ({
  after,
  since: since ?? null,
  until: until ?? null,
  kinds: kind === undefined ? null : `,${kind.join(',')},`,
});

const toRow = (row: Record<string, unknown>): TimelineRow => ({
  seq: Number(row.seq),
  time: String(row.time),
  kind: row.kind as TimelineKind,
  by: row.by === null ? null : String(row.by),
  data: JSON.parse(String(row.data)),
  ...stamps(row),
});

// The kind of row that causes an event raised from within
const CAUSES = { peer: 'notice', parameter: 'parameters' } as const;

// Who raised an event: a subscription or a parameter from within, or
// else the caller, a script when it holds the token of the scripts
function sourceOf(): string {
  const { by, source } = currentCaller();
  return source ?? (by === 'script' ? 'script' : 'client');
}

// Writes and reads the timeline of the database that Queue holds. A
// write that fails is logged and stops nothing, as no reply depends on
// it. Without a database, as in a test of another class, it keeps
// nothing.
export default class Timeline {
  private readonly logger = new Logger(Timeline.name);

  // the last row of each kind, which a later row names as its cause
  private readonly last = new Map<TimelineKind, number>();

  // the row whose handling is in progress, which causes the entries
  // that it leads to
  private handling: number | undefined;

  // The time that a row stands for, in a replay twin only
  private at: () => string | undefined = () => undefined;

  constructor(private readonly db?: () => DatabaseSync) {}

  // A replay twin stamps each row with the time that it stands for
  standFor(at: () => string | undefined): void {
    this.at = at;
  }

  // Writes a row and returns its seq, 0 when it could not be written.
  // by is the caller of the request in progress, unless given: null for
  // what the runner does by itself.
  record(kind: TimelineKind, data: Data, by?: string | null): number {
    const who = by === undefined ? (currentCaller().by ?? null) : by;
    try {
      const { lastInsertRowid } = this.statement(INSERT).run(
        new Date().toISOString(),
        kind,
        who,
        JSON.stringify(data),
        this.at() ?? null,
        originOf(kind),
      );
      this.last.set(kind, Number(lastInsertRowid));
      return Number(lastInsertRowid);
    } catch (error) {
      return this.failed(error);
    }
  }

  // Writes the row of a transition or event request, handles the
  // request, and completes the row with its reply. The entries that the
  // handling leads to name the row as their cause.
  request<Reply extends Data>(
    kind: 'transition' | 'event',
    name: string,
    handle: () => Reply,
  ): Reply {
    const seq = this.record(kind, this.asked(kind, name));
    const outer = this.handling;
    this.handling = seq;
    try {
      const reply = handle();
      this.complete(seq, 'reply', reply);
      return reply;
    } finally {
      this.handling = outer;
    }
  }

  // Writes the row of a command or a what-if request, submits the
  // command, and completes the row with the run in the history that the
  // submit names at once; a refused request has no run, and a repeated
  // one gets stored: true beside the run whose stored reply it got
  command<Result>(
    { name, input }: { name: string; input?: Data },
    submit: (onRun: (run: number, stored?: boolean) => void) => Result,
    kind: 'command' | 'whatif' = 'command',
  ): Result {
    const seq = this.record(kind, { name, input, run: null });
    return submit((run, stored) => {
      this.complete(seq, 'run', run);
      if (stored === true) {
        this.complete(seq, 'stored', true);
      }
    });
  }

  // Writes the changes of one request, if any
  changes(kind: 'parameters' | 'properties' | 'peers', values: Data): void {
    if (Object.keys(values).length > 0) {
      this.record(kind, values);
    }
  }

  // The machine entered a state: by the request in progress, or else by
  // the completion of the script that last exited
  entered(state: string, entry: number): void {
    const cause = this.handling ?? this.last.get('exit') ?? null;
    this.record('entry', { state, entry, cause }, null);
  }

  // The script of an entry ended, with its status and its run in the
  // history, or none when it never started
  exited(exit: {
    state: string;
    entry: number;
    status: string;
    run: number | null;
  }): void {
    this.record('exit', exit, null);
  }

  // The seq of the last row that was not sent, which led to what is sent
  // next; 0 before the first
  lastCause(): number {
    const kinds = [...this.last].filter(([kind]) => kind !== 'sent');
    return Math.max(0, ...kinds.map(([, seq]) => seq));
  }

  rows(query: TimelineQuery): TimelineRow[] {
    return this.statement(ROWS)
      .all({ ...bound(query), limit: query.limit })
      .map(toRow);
  }

  // The seq of the last row, 0 before the first
  lastSeq(): number {
    return Number(this.statement(LAST_SEQ).get()?.seq);
  }

  count(query: TimelineQuery): number {
    return Number(this.statement(COUNT).get(bound(query))?.count);
  }

  private asked(kind: 'transition' | 'event', name: string): Data {
    if (kind === 'transition') {
      return { state: name };
    }
    const { source, peer } = currentCaller();
    const cause = source && (this.last.get(CAUSES[source]) ?? null);
    return { event: name, source: sourceOf(), peer, cause };
  }

  private complete(seq: number, key: string, value: unknown): void {
    try {
      this.statement(COMPLETE).run(key, JSON.stringify(value), seq);
    } catch (error) {
      this.failed(error);
    }
  }

  private statement(sql: string) {
    if (this.db === undefined) {
      throw new Error('no database');
    }
    return this.db().prepare(sql);
  }

  private failed(error: unknown): number {
    if (this.db !== undefined) {
      this.logger.error(`Could not write the timeline: ${error}`);
    }
    return 0;
  }
}
