import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Queue from 'src/queue.service';

const T1 = '2026-11-22T10:00:00.000Z';

const T2 = '2026-11-22T10:00:05.000Z';

// The tables of 0.10.0, which has no properties table
const SCHEMA_0_10 = `
  CREATE TABLE parameters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    changed_at TEXT NOT NULL
  );
  INSERT INTO parameters (name, value, changed_at)
    VALUES ('scope', '"multi"', '${T1}');`;

describe('Queue properties', () => {
  let dir: string;
  let file: string;
  let queue: Queue;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-'));
    file = join(dir, 'runner.db');
    queue = new Queue();
  });

  afterEach(() => {
    queue.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should have no properties before the first write', () => {
    expect(queue.storedProperties()).toEqual([]);
  });

  it('Should keep the values of every JSON type, with time and writer', () => {
    const rows = [
      { name: 'forecast', value: [1, 0.5], time: T1, by: 'script' },
      { name: 'free-beds', value: 1, time: T1, by: null },
      {
        name: 'ward',
        value: { name: 'a', open: true },
        time: T1,
        by: 'gateway',
      },
      { name: 'ward-status', value: null, time: T1, by: 'script' },
    ];
    queue.saveProperties(rows);

    expect(queue.storedProperties()).toEqual(rows);
  });

  it('Should keep one row for each name, the latest', () => {
    queue.open(file);
    queue.saveProperties([
      { name: 'free-beds', value: 2, time: T1, by: 'script' },
    ]);
    queue.saveProperties([
      { name: 'free-beds', value: 1, time: T2, by: 'gateway' },
    ]);
    queue.close();
    const db = new DatabaseSync(file);
    const rows = db
      .prepare('SELECT name, value, time, by FROM properties')
      .all();
    db.close();

    expect(rows).toEqual([
      { name: 'free-beds', value: '1', time: T2, by: 'gateway' },
    ]);
  });

  it('Should store the rows of one write together, or none of them', () => {
    const bad = { name: 'bad', value: 1n, time: T1, by: null };

    expect(() =>
      queue.saveProperties([
        { name: 'free-beds', value: 1, time: T1, by: null },
        bad,
      ]),
    ).toThrow(TypeError);
    expect(queue.storedProperties()).toEqual([]);
  });

  it('Should keep the values across a restart', () => {
    queue.open(file);
    queue.saveProperties([
      { name: 'free-beds', value: 1, time: T1, by: 'script' },
    ]);
    queue.close();
    queue = new Queue();
    queue.open(file);

    expect(queue.storedProperties()).toEqual([
      { name: 'free-beds', value: 1, time: T1, by: 'script' },
    ]);
  });

  it('Should open a database of 0.10.0, which has no properties', () => {
    const old = new DatabaseSync(file);
    old.exec(SCHEMA_0_10);
    old.close();
    queue.open(file);

    expect(queue.storedProperties()).toEqual([]);
    expect(queue.parameterValues()).toEqual({ scope: 'multi' });

    queue.saveProperties([{ name: 'free-beds', value: 1, time: T1, by: null }]);

    expect(queue.storedProperties()).toHaveLength(1);
  });
});
