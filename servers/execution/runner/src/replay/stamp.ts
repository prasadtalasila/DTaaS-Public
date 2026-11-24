import { currentCaller } from '../auth/caller-context.js';
import type { TimelineKind, TimelineRow } from '../dto/timeline.dto.js';

// The kinds of row that a caller sends to a replay twin as an input
const INPUTS: ReadonlySet<TimelineKind> = new Set([
  'transition',
  'event',
  'command',
  'parameters',
  'properties',
  'peers',
  'notice',
]);

// The origin of a row of an input that a request to a replay twin
// writes, as JSON, or null; an event raised from within has none
export function originOf(kind: TimelineKind): string | null {
  const { origin, source } = currentCaller();
  const input = INPUTS.has(kind) && source === undefined;
  return input && origin !== undefined ? JSON.stringify(origin) : null;
}

// at and origin of a row as the database holds them, each left out
// when null
export const stamps = (row: Record<string, unknown>): Partial<TimelineRow> => ({
  ...(row.at === null ? {} : { at: String(row.at) }),
  ...(row.origin === null ? {} : { origin: JSON.parse(String(row.origin)) }),
});
