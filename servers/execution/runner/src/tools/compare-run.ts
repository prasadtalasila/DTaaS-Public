import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { DATABASE } from '../snapshot/snapshot.js';
import { MANIFEST } from '../snapshot/store.js';
import { align } from './align.js';
import { Range, readEntries } from './entries.js';
import { compared, listing, Side } from './listing.js';
import { say, ToolError } from './tool-error.js';

// What compare reads of replay.json
const replaySchema = z.object({
  of: z.string(),
  from: z.object({ seq: z.number() }),
  until: z.object({ seq: z.number().nullable() }),
  firstStep: z.number().nullable().default(null),
});

type Replay = z.infer<typeof replaySchema>;

const manifestSchema = z.object({ id: z.string() });

// A directory to compare: a snapshot, or the out of a replay
type Source = { dir: string; id: string; replay?: Replay };

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

const neither = (given: string): ToolError =>
  new ToolError(`${given} is neither a snapshot nor the out of a replay`);

function sourceOf(given: string): Source {
  const dir = resolve(given);
  if (!existsSync(join(dir, DATABASE))) {
    throw neither(given);
  }
  const replay = replaySchema.safeParse(readJson(join(dir, 'replay.json')));
  if (replay.success) {
    return { dir, id: `${replay.data.of}.replay`, replay: replay.data };
  }
  const manifest = manifestSchema.safeParse(readJson(join(dir, MANIFEST)));
  if (!manifest.success) {
    throw neither(given);
  }
  return { dir, id: manifest.data.id };
}

// A replay after its start; a snapshot beside a replay over the same
// stretch, and else the whole of it
function rangeOf(own: Source, other: Source): Range {
  if (own.replay !== undefined) {
    return { after: own.replay.from.seq, skip: own.replay.firstStep };
  }
  return other.replay === undefined
    ? { after: 0 }
    : { after: other.replay.from.seq, upTo: other.replay.until.seq };
}

function sideOf(own: Source, other: Source): Side {
  const file = join(own.dir, DATABASE);
  const entries = readEntries(
    file,
    own.replay !== undefined,
    rangeOf(own, other),
  );
  return { dir: own.dir, id: own.id, entries };
}

// runner-compare: 0 when the entries are the same, 1 when they differ
export function compare(a: string, b: string, json: boolean): number {
  const [sa, sb] = [sourceOf(a), sourceOf(b)];
  const [left, right] = [sideOf(sa, sb), sideOf(sb, sa)];
  const result = compared(left, right, align(left.entries, right.entries));
  say(json ? JSON.stringify(result, null, 2) : listing(result));
  return result.same ? 0 : 1;
}
