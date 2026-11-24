import { z } from 'zod';
import type { CommandResult } from '../interfaces/command.interface.js';
import { STORED_STATUS, toHistoryEntry } from '../queue.history.js';
import type { ScriptResources } from '../resources/resources.js';
import type { CommandStateStatus } from './state.dto.js';

// The payload of MQTT whatif, which reads the result of a run
export const whatIfResultSchema = z.object({ id: z.number().int().min(1) });

// The reply of POST /whatif: the run in the command history
export type WhatIfReplyDto = { id: number; name: string; status: 'running' };

// The run as GET /whatif/<id> shows it; exitCode, result, finishedAt
// and resources once it has ended
export type WhatIfRunDto = {
  id: number;
  name: string;
  status: CommandStateStatus;
  mode: 'what-if';
  receivedAt: string;
  by: string | null;
  exitCode?: number | null;
  result?: unknown;
  finishedAt?: string;
  resources?: ScriptResources;
};

// The data of a whatif notification
export type WhatIfEndDto = {
  id: number;
  name: string;
  status: string;
  exitCode: number | null;
  result: unknown;
};

// What the script printed: JSON, or else the text
export function parsedResult(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return stdout;
  }
}

export function toWhatIfRun(row: Record<string, unknown>): WhatIfRunDto {
  const { id, name, status, receivedAt, by, ...ended } = toHistoryEntry(row);
  const run = { id, name, status, mode: 'what-if' as const, receivedAt, by };
  if (ended.finishedAt === null) {
    return run;
  }
  const { exitCode, finishedAt, resources } = ended;
  const result = parsedResult(String(row.stdout));
  return { ...run, exitCode, result, finishedAt, resources };
}

export const endOf = (
  { id, name }: { id: number; name: string },
  [outcome, logs, exitCode]: CommandResult,
): WhatIfEndDto => ({
  id,
  name,
  status: STORED_STATUS[outcome],
  exitCode,
  result: parsedResult(logs.get('stdout') ?? ''),
});
