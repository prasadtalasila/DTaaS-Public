import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { callerContext } from 'src/auth/caller-context';
import Queue from 'src/queue.service';

// The timeline of issue 24, before issue 25, without at and origin
const OLD_TIMELINE = `
  CREATE TABLE timeline (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT NOT NULL,
    kind TEXT NOT NULL,
    by TEXT,
    data TEXT NOT NULL
  );
  INSERT INTO timeline (time, kind, by, data)
    VALUES ('2026-11-22T21:00:00.000Z', 'start', NULL, '{}');`;

const ORIGIN = { by: 'manager-1', seq: 42 };

describe('The timeline of a replay twin', () => {
  let dir: string;
  let queue: Queue;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-timeline-replay-'));
    const file = join(dir, 'dt.db');
    const db = new DatabaseSync(file);
    db.exec(OLD_TIMELINE);
    db.close();
    queue = new Queue();
    queue.open(file);
  });

  afterEach(() => {
    queue.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const rows = () =>
    queue.timeline.rows({ after: 0, limit: 100, count: false });

  it('Should read a row of an older version without at and origin', () => {
    expect(rows()[0]).toEqual({
      seq: 1,
      time: '2026-11-22T21:00:00.000Z',
      kind: 'start',
      by: null,
      data: {},
    });
  });

  it('Should stamp a row with the time that it stands for', () => {
    queue.timeline.standFor(() => '2026-11-22T22:00:00.000Z');
    queue.timeline.record('stop', {}, null);

    expect(rows()[1].at).toBe('2026-11-22T22:00:00.000Z');
  });

  it('Should give the origin to the row of an input alone', () => {
    callerContext.run({ by: 'replay', origin: ORIGIN }, () => {
      queue.timeline.record('event', { event: 'next' });
      queue.timeline.entered('work', 1);
    });
    callerContext.run({ source: 'parameter', origin: ORIGIN }, () =>
      queue.timeline.record('event', { event: 'raised' }, null),
    );
    const [, event, entry, raised] = rows();

    expect(event).toMatchObject({ by: 'replay', origin: ORIGIN });
    expect(entry).not.toHaveProperty('origin');
    expect(raised).not.toHaveProperty('origin');
  });
});
