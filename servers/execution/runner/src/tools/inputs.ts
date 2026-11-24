import { DatabaseSync } from 'node:sqlite';
import type { TimelineKind, TimelineRow } from '../dto/timeline.dto.js';
import Timeline from '../queue.timeline.js';
import type { Step, StepKind } from './replay-file.js';
import { STEP_KINDS } from './replay-file.js';

// What a replay sends: the time that it stands for, and the request; by
// and seq are those of the row in the twin, which a step has not
export type Input = {
  time: string;
  kind: StepKind;
  by: string | null;
  seq?: number;
  method: 'POST' | 'PUT';
  path: string;
  body: unknown;
  // a command that got the stored reply of the run, which is not sent
  stored?: number;
};

type Data = Record<string, unknown>;

type Request = Pick<Input, 'method' | 'path' | 'body'>;

const put = (path: string, body: unknown): Request => ({
  method: 'PUT',
  path,
  body,
});

const post = (path: string, body: unknown): Request => ({
  method: 'POST',
  path,
  body,
});

// The request of an input in the form of a step
const REQUESTS: Record<StepKind, (value: never) => Request> = {
  transition: (state: string) => post('/fsm/transition', { state }),
  event: (event: string) => post('/fsm/event', { event }),
  command: ({ name, input }: Data) => post('/', { name, input }),
  parameters: (values: Data) => put('/parameters', values),
  properties: (values: Data) => put('/properties', values),
  peers: (values: Data) => put('/peers', values),
  notice: ({ peer, kind, data }: Data) =>
    put(`/peers/${String(peer)}/notice`, { kind, data }),
};

// The value of a row in the form of a step
const VALUES: Record<StepKind, (data: Data) => unknown> = {
  transition: (data) => data.state,
  event: (data) => data.event,
  command: ({ name, input }) => ({ name, input }),
  parameters: (data) => data,
  properties: (data) => data,
  peers: (data) => data,
  notice: (data) => data,
};

const always = () => true;

// The rows that entered the twin from outside: an event that a client
// sent, and properties that a listed principal wrote, not a script
const SENT: Partial<
  Record<TimelineKind, (row: TimelineRow, roles: Roles) => boolean>
> = {
  transition: always,
  command: always,
  parameters: always,
  peers: always,
  notice: always,
  event: ({ by, data }) => data.source === 'client' && by !== 'script',
  properties: ({ by }, roles) =>
    ['sensor', 'client'].includes(roles.get(by ?? '') ?? ''),
};

// The role of each principal of the copy of runner.yaml
export type Roles = ReadonlyMap<string, string>;

export const isInput = (row: TimelineRow, roles: Roles): boolean =>
  SENT[row.kind]?.(row, roles) ?? false;

const request = (kind: StepKind, value: unknown): Request =>
  REQUESTS[kind](value as never);

// A repeated command that got the stored reply names its run
const storedRun = ({ data }: TimelineRow) =>
  data.stored === true ? { stored: Number(data.run) } : {};

export function rowInput(row: TimelineRow): Input {
  const kind = row.kind as StepKind;
  const { time, by, seq } = row;
  const sent = request(kind, VALUES[kind](row.data));
  return { time, kind, by, seq, ...sent, ...storedRun(row) };
}

export function stepInput(step: Step): Input {
  const kind = STEP_KINDS.find((name) => step[name] !== undefined) as StepKind;
  return { time: step.at, kind, by: null, ...request(kind, step[kind]) };
}

// The rows of the timeline in the database after a seq, oldest first
export function readRows(file: string, after: number): TimelineRow[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const query = { after, limit: Number.MAX_SAFE_INTEGER, count: false };
    return new Timeline(() => db).rows(query);
  } finally {
    db.close();
  }
}

const before =
  (until?: string) =>
  ({ time }: { time: string }) =>
    until === undefined || time < until;

// The inputs of the rows up to a seq and before a time
export const rowInputs = (
  rows: TimelineRow[],
  roles: Roles,
  { seq, until }: { seq: number; until?: string },
): Input[] =>
  rows
    .filter(
      (row) => row.seq <= seq && before(until)(row) && isInput(row, roles),
    )
    .map(rowInput);

// The steps before a time, in the order of their times
export const stepInputs = (steps: Step[], until?: string): Input[] =>
  steps
    .map(stepInput)
    .filter(before(until))
    .sort((a, b) => a.time.localeCompare(b.time));
