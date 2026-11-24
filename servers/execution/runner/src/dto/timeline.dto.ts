import { z } from 'zod';

// What enters the DT, what changes in it, and what it sends
export const TIMELINE_KINDS = [
  'start',
  'transition',
  'event',
  'command',
  'stop',
  'parameters',
  'properties',
  'peers',
  'notice',
  'entry',
  'exit',
  'sent',
  'shutdown',
  'snapshot',
] as const;

export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export const TIMELINE_LIMIT = 1000;

const time = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

const kinds = z
  .string()
  .transform((value) => value.split(','))
  .pipe(z.array(z.enum(TIMELINE_KINDS)).min(1));

// The query of GET /timeline, or the payload of MQTT timeline. A row is
// told from the next by its seq, so a reader pages with after. zod 4's
// .default would give {} without running the inner defaults, so
// .prefault.
export const timelineQuerySchema = z
  .object({
    after: z.coerce.number().int().min(0).default(0),
    since: time.optional(),
    until: time.optional(),
    kind: kinds.optional(),
    limit: z.coerce.number().int().min(1).max(TIMELINE_LIMIT).default(100),
    count: z.union([z.boolean(), z.stringbool()]).default(false),
  })
  .prefault({});

export type TimelineQuery = z.infer<typeof timelineQuerySchema>;

// A row of the timeline: seq only rises, time is that of the runner to
// the millisecond, and by is the principal, script, or null
export type TimelineRow = {
  seq: number;
  time: string;
  kind: TimelineKind;
  by: string | null;
  data: Record<string, unknown>;
};

export type TimelineCount = { count: number };

// The rows as a caller may see them: the input of a command may name a
// person, so only a client or an operator, or anyone without access
// control, reads it
export const visibleRows = (rows: TimelineRow[], full: boolean) =>
  full
    ? rows
    : rows.map((row) =>
        row.kind === 'command'
          ? { ...row, data: { ...row.data, input: undefined } }
          : row,
      );

// What the timeline holds for a reader
export type TimelineSource = {
  rows(query: TimelineQuery): TimelineRow[];
  count(query: TimelineQuery): number;
};

// The roles that read the input of a command row
const FULL_READERS = new Set(['client', 'operator']);

// The reply of GET /timeline: the rows, or their number. Without
// access control there is no principal, and every reader sees all.
export function timelineReply(
  timeline: TimelineSource,
  query: TimelineQuery,
  principal?: { role: string },
): TimelineRow[] | TimelineCount {
  if (query.count) {
    return { count: timeline.count(query) };
  }
  const full = principal === undefined || FULL_READERS.has(principal.role);
  return visibleRows(timeline.rows(query), full);
}
