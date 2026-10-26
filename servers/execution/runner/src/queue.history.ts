import type { CommandRecord } from './interfaces/command.interface.js';

// The table keeps SQLite's YYYY-MM-DD HH:MM:SS times, which the query
// turns into ISO 8601 UTC; strftime of NULL is NULL
export const RECORD = `SELECT id, name, status, stdout, stderr,
  exit_code AS exitCode,
  strftime('%Y-%m-%dT%H:%M:%fZ', received_at) AS receivedAt,
  strftime('%Y-%m-%dT%H:%M:%fZ', finished_at) AS finishedAt,
  finished_at IS NOT NULL AS finished FROM commands`;

export const RECORD_BY_KEY = `${RECORD} WHERE id =
  (SELECT command_id FROM request_keys WHERE request_key = ?)`;

export function toRecord(
  row: Record<string, unknown> | undefined,
): CommandRecord | undefined {
  if (row === undefined) {
    return undefined;
  }
  return {
    id: Number(row.id),
    name: String(row.name),
    status: String(row.status),
    stdout: String(row.stdout),
    stderr: String(row.stderr),
    exitCode: row.exitCode as number | null,
    finished: Boolean(row.finished),
    receivedAt: String(row.receivedAt),
    finishedAt: row.finishedAt as string | null,
  };
}
