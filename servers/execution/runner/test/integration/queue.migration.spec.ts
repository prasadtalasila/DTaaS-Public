import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import Queue from 'src/queue.service';

// The commands table of version 0.6.0, which has no exit_code column
const OLD_SCHEMA = `
  CREATE TABLE commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'invalid',
    stdout TEXT NOT NULL DEFAULT '',
    stderr TEXT NOT NULL DEFAULT '',
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT
  );
  INSERT INTO commands (name, finished_at)
    VALUES ('create', CURRENT_TIMESTAMP);`;

// A database file of 0.6.0 with one finished command
function oldDatabase(dir: string): string {
  const file = join(dir, 'runner.db');
  const old = new DatabaseSync(file);
  old.exec(OLD_SCHEMA);
  old.close();
  return file;
}

// The number of columns of the commands table with the name
const columnCount = (file: string, column: string): number => {
  const db = new DatabaseSync(file);
  const columns = db.prepare('PRAGMA table_info(commands)').all();
  db.close();
  return columns.filter(({ name }) => name === column).length;
};

// The caller stored with each command, by id
const callers = (file: string): unknown[] => {
  const db = new DatabaseSync(file);
  const rows = db.prepare('SELECT by FROM commands ORDER BY id').all();
  db.close();
  return rows.map(({ by }) => by);
};

describe('Queue exit codes and statuses', () => {
  let dir: string;
  let queue: Queue;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-'));
    queue = new Queue();
  });

  afterEach(() => {
    queue.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('should add the exit code column to a database of 0.6.0 once', () => {
    const file = oldDatabase(dir);

    queue.open(file);
    const id = queue.enqueue('create');
    queue.complete(id, ['failed', new Map(), 3]);
    queue.close();
    queue = new Queue();
    queue.open(file);

    expect(queue.activeCommand()).toMatchObject({ id, exitCode: 3 });
    queue.close();
    expect(columnCount(file, 'exit_code')).toBe(1);
  });

  it('should add the by column to a database of 0.6.0 once', () => {
    const file = oldDatabase(dir);

    queue.open(file);
    queue.enqueue('create', undefined, 'alice');
    queue.close();
    queue = new Queue();
    queue.open(file);
    queue.close();

    expect(columnCount(file, 'by')).toBe(1);
    expect(callers(file)).toEqual([null, 'alice']);
  });

  it('should store the caller of a command, NULL without one', () => {
    const file = join(dir, 'runner.db');
    queue.open(file);

    queue.enqueue('create', 'key-1', 'manager-1');
    queue.enqueue('create', undefined, 'script');
    queue.enqueue('create');
    queue.close();

    expect(callers(file)).toEqual(['manager-1', 'script', null]);
  });

  it('should have no exit code for a command of 0.6.0', () => {
    const file = oldDatabase(dir);

    queue.open(file);

    expect(queue.activeCommand()).toMatchObject({
      name: 'create',
      status: 'invalid',
      exitCode: null,
      finished: true,
    });
  });

  it('should finish a refused command as invalid and signal it', () => {
    const changed = jest.fn();
    queue.onChange(changed);
    const id = queue.enqueue('configure');

    queue.refuse(id);

    expect(queue.activeCommand()).toMatchObject({
      status: 'invalid',
      exitCode: null,
      finished: true,
    });
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
