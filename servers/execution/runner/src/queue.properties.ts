import { DatabaseSync } from 'node:sqlite';
import type { PropertyRow } from './fsm/properties.js';

// The latest value of each property, as JSON, with the time of its
// write and the principal that wrote it; a write replaces the row, so
// the table does not grow with the rate of the writes
export const PROPERTIES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS properties (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    time TEXT NOT NULL,
    by TEXT
  )`;

const UPSERT = `INSERT INTO properties (name, value, time, by)
  VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET
  value = excluded.value, time = excluded.time, by = excluded.by`;

export function upsertProperties(db: DatabaseSync, rows: PropertyRow[]): void {
  const upsert = db.prepare(UPSERT);
  rows.forEach(({ name, value, time, by }) =>
    upsert.run(name, JSON.stringify(value), time, by),
  );
}

export const storedProperties = (db: DatabaseSync): PropertyRow[] =>
  db
    .prepare('SELECT name, value, time, by FROM properties ORDER BY name')
    .all()
    .map(({ name, value, time, by }) => ({
      name: String(name),
      value: JSON.parse(String(value)),
      time: String(time),
      by: by === null ? null : String(by),
    }));
