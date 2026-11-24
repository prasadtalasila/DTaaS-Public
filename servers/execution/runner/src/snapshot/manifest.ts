import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { SNAPSHOT_FORMAT } from '../dto/snapshot.dto.js';
import type { DtClass } from '../fsm/class.js';
import { MANIFEST } from './store.js';

// What reinstating reads of snapshot.json
const manifestSchema = z.object({
  format: z.literal(SNAPSHOT_FORMAT),
  id: z.string(),
  class: z.object({ id: z.string(), version: z.string() }).nullable(),
  time: z.string(),
  seq: z.number(),
  machine: z
    .object({ state: z.string().nullable(), status: z.string() })
    .nullable()
    .optional(),
});

export type ReadManifest = z.infer<typeof manifestSchema>;

export const refusal = (file: string, reason: string): Error =>
  new Error(`Can not reinstate from ${file}: ${reason}`);

async function readJson(file: string): Promise<unknown> {
  const text = await readFile(file, 'utf8').catch(() => {
    throw refusal(file, 'there is no manifest of a snapshot');
  });
  try {
    return JSON.parse(text);
  } catch {
    throw refusal(file, 'it is no JSON');
  }
}

// The format comes first, as a later format may have other fields
export async function readManifest(directory: string): Promise<ReadManifest> {
  const file = join(directory, MANIFEST);
  const json = await readJson(file);
  const format = (json as { format?: unknown } | null)?.format;
  if (format !== SNAPSHOT_FORMAT) {
    const reason = `format ${JSON.stringify(format)} is not ${SNAPSHOT_FORMAT}, the format that this runner reads`;
    throw refusal(file, reason);
  }
  const result = manifestSchema.safeParse(json);
  if (!result.success) {
    throw refusal(file, z.prettifyError(result.error));
  }
  return result.data;
}

const named = (dtClass: DtClass | null | undefined): string =>
  dtClass ? `of class ${dtClass.id}` : 'without a class';

// The class of the snapshot and that of the state machine file have the
// same id, or neither has a class
export function checkClass(
  directory: string,
  saved: DtClass | null,
  { dtClass, file }: { dtClass?: DtClass; file?: string },
): void {
  if (saved?.id !== dtClass?.id) {
    const own = file ?? 'the runner without a state machine file';
    const reason = `the snapshot is ${named(saved)}, and ${own} is ${named(dtClass)}`;
    throw refusal(join(directory, MANIFEST), reason);
  }
}

// A runner does not write a snapshot over a twin that it has
export function checkDatabase(
  config: string,
  database: string | undefined,
): string {
  if (database === undefined) {
    throw new Error(`Can not reinstate with ${config}: it names no database`);
  }
  if (existsSync(database)) {
    throw new Error(
      `Can not reinstate into ${database}: the database exists already`,
    );
  }
  return database;
}
