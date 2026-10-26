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

const exitCodeColumns = (file: string): number => {
  const db = new DatabaseSync(file);
  const columns = db.prepare('PRAGMA table_info(commands)').all();
  db.close();
  return columns.filter(({ name }) => name === 'exit_code').length;
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
    expect(exitCodeColumns(file)).toBe(1);
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
