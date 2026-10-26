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
import { StoredMachine } from './dto/fsm.dto.js';
import { RunOutcome } from './interfaces/runner.interface.js';
import { ParameterValue } from './dto/parameters.dto.js';
import Changes, { ChangeListener } from './notify/changes.js';
import {
  LOAD_MACHINE,
  MARK_INTERRUPTED,
  SAVE_MACHINE,
  toStoredMachine,
} from './queue.machine.js';
import { createSchema } from './queue.schema.js';

// The table keeps SQLite's YYYY-MM-DD HH:MM:SS times, which the query
// turns into ISO 8601 UTC; strftime of NULL is NULL
const RECORD = `SELECT id, name, status, stdout, stderr,
  exit_code AS exitCode,
  strftime('%Y-%m-%dT%H:%M:%fZ', received_at) AS receivedAt,
  strftime('%Y-%m-%dT%H:%M:%fZ', finished_at) AS finishedAt,
  finished_at IS NOT NULL AS finished FROM commands`;

const RECORD_BY_KEY = `${RECORD} WHERE id =
  (SELECT command_id FROM request_keys WHERE request_key = ?)`;

// The status of a finished command in the commands table; a command
// that is not permitted keeps the default, invalid
const STATUS: Record<RunOutcome, string> = {
  success: 'valid',
  failed: 'failed',
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
    exitCode: row.exitCode as number | null,
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
    createSchema(db);
    return db;
  }

  // by is the caller that submitted the command, if one did
  enqueue(name: string, requestKey?: string, by?: string): number {
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO commands (name, by) VALUES (?, ?)')
      .run(name, by ?? null);
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

  complete(id: number, [outcome, logs, exitCode]: CommandResult): void {
    this.db
      .prepare(
        `UPDATE commands SET status = ?, stdout = ?, stderr = ?,
          exit_code = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(
        STATUS[outcome],
        logs.get('stdout') ?? '',
        logs.get('stderr') ?? '',
        exitCode,
        id,
      );
    this.changes.emit();
  }

  // Finishes a command that is not permitted, which stays invalid
  refuse(id: number): void {
    this.db
      .prepare(
        'UPDATE commands SET finished_at = CURRENT_TIMESTAMP WHERE id = ?',
      )
      .run(id);
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

  // The machine of the state machine service, which no change signals
  saveMachine({ state, entry, status }: StoredMachine): void {
    this.db.prepare(SAVE_MACHINE).run(state ?? null, entry, status);
  }

  loadMachine(): StoredMachine | undefined {
    return toStoredMachine(this.db.prepare(LOAD_MACHINE).get());
  }

  // Marks the commands that never finished, as no script survives a
  // restart; time is an ISO 8601 time
  markInterrupted(time: string): void {
    this.db.prepare(MARK_INTERRUPTED).run(time);
  }
}
