import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Injectable, Scope } from '@nestjs/common';
import {
  CommandRecord,
  CommandResult,
} from './interfaces/command.interface.js';
import { ExecuteCommandDto } from './dto/command.dto.js';
import { DatabaseMode } from './dto/health.dto.js';
import { RunOutcome } from './interfaces/runner.interface.js';
import { ParameterValue } from './dto/parameters.dto.js';
import Changes, { ChangeListener } from './notify/changes.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'invalid',
    stdout TEXT NOT NULL DEFAULT '',
    stderr TEXT NOT NULL DEFAULT '',
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT
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
  )`;

// The table keeps SQLite's YYYY-MM-DD HH:MM:SS times, which the query
// turns into ISO 8601 UTC; strftime of NULL is NULL
const RECORD = `SELECT id, name, status, stdout, stderr,
  strftime('%Y-%m-%dT%H:%M:%fZ', received_at) AS receivedAt,
  strftime('%Y-%m-%dT%H:%M:%fZ', finished_at) AS finishedAt,
  finished_at IS NOT NULL AS finished FROM commands`;

const RECORD_BY_KEY = `${RECORD} WHERE id =
  (SELECT command_id FROM request_keys WHERE request_key = ?)`;

// The status of a finished command in the commands table
const STATUS: Record<RunOutcome, string> = {
  success: 'valid',
  failed: 'invalid',
  stopped: 'stopped',
};

function toRecord(
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
    finished: Boolean(row.finished),
    receivedAt: String(row.receivedAt),
    finishedAt: row.finishedAt as string | null,
  };
}

// Keeps the received commands and their results in SQLite, in memory
// unless open() names a database file
@Injectable({ scope: Scope.DEFAULT })
export default class Queue {
  private db = Queue.connect(':memory:');

  // Signals a command that starts or finishes
  private readonly changes = new Changes();

  onChange(listener: ChangeListener): void {
    this.changes.on(listener);
  }

  open(file: string | undefined): void {
    if (file !== undefined) {
      mkdirSync(dirname(file), { recursive: true });
      this.db.close();
      this.db = Queue.connect(file);
    }
  }

  // a second close, as from a second shutdown, does nothing
  close(): void {
    if (this.db.isOpen) {
      this.db.close();
    }
  }

  // waits up to five seconds for a database file that is locked
  private static connect(file: string): DatabaseSync {
    const db = new DatabaseSync(file, { timeout: 5000 });
    db.exec(SCHEMA);
    return db;
  }

  enqueue(name: string, requestKey?: string): number {
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO commands (name) VALUES (?)')
      .run(name);
    const id = Number(lastInsertRowid);
    if (requestKey !== undefined) {
      this.addKey(requestKey, id);
    }
    this.changes.emit();
    return id;
  }

  addKey(requestKey: string, commandId: number): void {
    this.db
      .prepare(
        'INSERT INTO request_keys (request_key, command_id) VALUES (?, ?)',
      )
      .run(requestKey, commandId);
  }

  complete(id: number, [outcome, logs]: CommandResult): void {
    this.db
      .prepare(
        `UPDATE commands SET status = ?, stdout = ?, stderr = ?,
          finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(
        STATUS[outcome],
        logs.get('stdout') ?? '',
        logs.get('stderr') ?? '',
        id,
      );
    this.changes.emit();
  }

  checkHistory(): Array<ExecuteCommandDto> {
    return this.db
      .prepare('SELECT name FROM commands ORDER BY id')
      .all()
      .map(({ name }) => ({ name: String(name) }));
  }

  activeCommand(): CommandRecord | undefined {
    return toRecord(
      this.db.prepare(`${RECORD} ORDER BY id DESC LIMIT 1`).get(),
    );
  }

  findByKey(requestKey: string): CommandRecord | undefined {
    return toRecord(this.db.prepare(RECORD_BY_KEY).get(requestKey));
  }

  // an in-memory database has no location
  mode(): DatabaseMode {
    return this.db.location() === null ? 'memory' : 'file';
  }

  // Records the changes of one request together, or none of them
  setParameters(changes: ReadonlyMap<string, ParameterValue>): void {
    const insert = this.db.prepare(
      'INSERT INTO parameters (name, value, changed_at) VALUES (?, ?, ?)',
    );
    const time = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      changes.forEach((value, name) =>
        insert.run(name, JSON.stringify(value), time),
      );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // The latest value of each parameter; the highest id is the latest,
  // as two changes can share a timestamp
  parameterValues(): Record<string, ParameterValue> {
    const rows = this.db
      .prepare(
        `SELECT name, value FROM parameters WHERE id IN
          (SELECT MAX(id) FROM parameters GROUP BY name)`,
      )
      .all();
    return Object.fromEntries(
      rows.map(({ name, value }) => [String(name), JSON.parse(String(value))]),
    );
  }
}
