import { DatabaseSync } from 'node:sqlite';
import { MACHINE_SCHEMA } from './queue.machine.js';
import { PEERS_SCHEMA } from './queue.peers.js';
import { PROPERTIES_SCHEMA } from './queue.properties.js';
import { TIMELINE_SCHEMA } from './queue.timeline.js';

// by is the principal that submitted a command: a name of runner.yaml,
// script, or NULL without access control and for a state's script.
// cpu_seconds, peak_rss_bytes and processes are what the process tree of
// its script used, NULL when not measured. mode is what-if for a run on
// a private copy of the twin, what-if-copy for the save run that makes
// the copy, NULL for every other.
export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'invalid',
    stdout TEXT NOT NULL DEFAULT '',
    stderr TEXT NOT NULL DEFAULT '',
    exit_code INTEGER,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    by TEXT,
    cpu_seconds REAL,
    peak_rss_bytes INTEGER,
    processes INTEGER,
    mode TEXT
  );
  -- the keys with which clients mark requests, and the command each
  -- request ran or joined
  CREATE TABLE IF NOT EXISTS request_keys (
    request_key TEXT PRIMARY KEY,
    command_id INTEGER NOT NULL REFERENCES commands (id)
  );
  -- each change of a parameter, with its value as JSON
  CREATE TABLE IF NOT EXISTS parameters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    changed_at TEXT NOT NULL
  );
  ${MACHINE_SCHEMA};
  ${PEERS_SCHEMA};
  ${PROPERTIES_SCHEMA};
  ${TIMELINE_SCHEMA}`;

// Runs the work in one transaction, which an error rolls back, and
// returns what the work returns
export function inTransaction<Result>(
  db: DatabaseSync,
  work: () => Result,
): Result {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Adds a column, given as "name TYPE", that a table of an older
// version lacks
function addColumn(db: DatabaseSync, table: string, column: string): void {
  const [name] = column.split(' ');
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((found) => found.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
  }
}

// A database file of a version before 0.7.0 has no exit_code column,
// one before 0.9.0 no by column, one before issue 17a no resource
// columns, one before issue 17b no processes column, and one before
// issue 24 no mode column; a timeline before issue 25 has no at and no
// origin column
export function createSchema(db: DatabaseSync): void {
  db.exec(SCHEMA);
  addColumn(db, 'commands', 'exit_code INTEGER');
  addColumn(db, 'commands', 'by TEXT');
  addColumn(db, 'commands', 'cpu_seconds REAL');
  addColumn(db, 'commands', 'peak_rss_bytes INTEGER');
  addColumn(db, 'commands', 'processes INTEGER');
  addColumn(db, 'commands', 'mode TEXT');
  addColumn(db, 'timeline', 'at TEXT');
  addColumn(db, 'timeline', 'origin TEXT');
}
