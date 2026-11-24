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
import { timelineQuerySchema } from 'src/dto/timeline.dto';
import Queue from 'src/queue.service';

// The rows that the query of GET /timeline selects
const query = (queue: Queue, given: Record<string, string> = {}) => {
  const parsed = timelineQuerySchema.parse(given);
  return parsed.count
    ? queue.timeline.count(parsed)
    : queue.timeline.rows(parsed).map(({ seq }) => seq);
};

describe('Queue timeline', () => {
  let dir: string;
  let file: string;
  let queues: Queue[];

  // A queue over the database file, as a start of the runner opens it
  const open = (): Queue => {
    const queue = new Queue();
    queue.open(file);
    queues.push(queue);
    return queue;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'timeline-'));
    file = join(dir, 'runner.db');
    queues = [];
  });

  afterEach(() => {
    jest.useRealTimers();
    queues.forEach((queue) => queue.close());
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should add the table to a database of 0.11.0', () => {
    open().enqueue('create');
    // 0.11.0 has every table of now but the timeline
    const old = new DatabaseSync(file);
    old.exec('DROP TABLE timeline');
    old.close();

    const queue = open();
    expect(queue.timeline.record('start', {}, null)).toBe(1);
    expect(queue.history({ limit: 10 })).toHaveLength(1);
  });

  it('Should keep the rows across a restart, and number on', () => {
    const first = open();
    first.timeline.record('start', { state: {} }, null);
    first.timeline.record('transition', { state: 'create' }, 'alice');
    first.close();

    const second = open();
    expect(second.timeline.record('start', {}, null)).toBe(3);
    expect(
      second.timeline
        .rows(timelineQuerySchema.parse({}))
        .map(({ seq, kind, by, data }) => [seq, kind, by, data]),
    ).toEqual([
      [1, 'start', null, { state: {} }],
      [2, 'transition', 'alice', { state: 'create' }],
      [3, 'start', null, {}],
    ]);
  });

  it('Should name the run that a command request was given, if any', () => {
    const { timeline } = open();
    const input = { patient: 'p-7' };

    timeline.command({ name: 'admit', input }, (onRun) => onRun(58));
    timeline.command({ name: 'admit' }, () => undefined);
    timeline.command({ name: 'admit', input }, (onRun) => onRun(58, true));

    const rows = timeline.rows(timelineQuerySchema.parse({}));
    expect(rows.map(({ data }) => data)).toEqual([
      { name: 'admit', input, run: 58 },
      { name: 'admit', run: null },
      { name: 'admit', input, run: 58, stored: true },
    ]);
  });

  describe('queries', () => {
    let queue: Queue;

    // Six rows, one a minute from 10:00, of the kinds in turn
    beforeEach(() => {
      queue = open();
      jest.useFakeTimers({ now: new Date('2026-11-24T10:00:00.000Z') });
      ['start', 'entry', 'exit', 'entry', 'exit', 'shutdown'].forEach(
        (kind) => {
          queue.timeline.record(kind as 'start', {}, null);
          jest.advanceTimersByTime(60000);
        },
      );
    });

    it('Should answer every row, oldest first, without a query', () => {
      expect(query(queue)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it.each([
      [{ after: '4' }, [5, 6]],
      [{ since: '2026-11-24T10:02:00.000Z' }, [3, 4, 5, 6]],
      [{ until: '2026-11-24T10:02:00.000Z' }, [1, 2]],
      [
        { since: '2026-11-24T11:01:00+01:00', until: '2026-11-24T10:03:00Z' },
        [2, 3],
      ],
      [{ kind: 'entry,shutdown' }, [2, 4, 6]],
      [{ limit: '2' }, [1, 2]],
      [{ after: '2', kind: 'exit', limit: '1' }, [3]],
    ])('Should select the rows of %j', (given, seqs) => {
      expect(query(queue, given)).toEqual(seqs);
    });

    it.each([
      [{ count: 'true' }, 6],
      [{ count: 'true', kind: 'exit' }, 2],
      [{ count: 'true', after: '3', limit: '1' }, 3],
    ])('Should count the rows of %j, whatever the limit', (given, count) => {
      expect(query(queue, given)).toBe(count);
    });
  });

  it.each([
    { after: '-1' },
    { after: 'x' },
    { since: 'yesterday' },
    { kind: 'bogus' },
    { kind: '' },
    { limit: '0' },
    { limit: '1001' },
    { count: 'maybe' },
  ])('Should refuse the query %j', (given) => {
    expect(timelineQuerySchema.safeParse(given).success).toBe(false);
  });
});
