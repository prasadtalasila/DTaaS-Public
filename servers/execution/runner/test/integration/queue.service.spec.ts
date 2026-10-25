import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Queue from 'src/queue.service';

// An ISO 8601 UTC time, as the queue returns its timestamps
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const logs = (stdout: string, stderr = '') =>
  new Map([
    ['stdout', stdout],
    ['stderr', stderr],
  ]);

describe('check Queue service', () => {
  let queue: Queue;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [Queue],
    }).compile();

    queue = module.get<Queue>(Queue);
  });

  afterEach(() => queue.close());

  it('should return active command as undefined when queue is empty', async () => {
    expect(queue.activeCommand()).toBe(undefined);
  });

  it('should record a command as unfinished and invalid until it completes', async () => {
    queue.enqueue('hello');

    expect(queue.activeCommand()).toEqual({
      id: 1,
      name: 'hello',
      status: 'invalid',
      stdout: '',
      stderr: '',
      finished: false,
      receivedAt: expect.stringMatching(ISO_TIME),
      finishedAt: null,
    });
  });

  it('should store the result of a completed command', async () => {
    const id = queue.enqueue('hello');
    queue.complete(id, ['success', logs('hello world', 'warning')]);

    expect(queue.activeCommand()).toEqual({
      id,
      name: 'hello',
      status: 'valid',
      stdout: 'hello world',
      stderr: 'warning',
      finished: true,
      receivedAt: expect.stringMatching(ISO_TIME),
      finishedAt: expect.stringMatching(ISO_TIME),
    });
  });

  it('should convert the timestamps that SQLite wrote to ISO 8601', () => {
    (queue as unknown as { db: DatabaseSync }).db
      .prepare(
        `INSERT INTO commands (name, received_at, finished_at)
          VALUES ('hello', '2026-10-25 09:59:58', '2026-10-25 10:00:00')`,
      )
      .run();

    expect(queue.activeCommand()).toMatchObject({
      receivedAt: '2026-10-25T09:59:58.000Z',
      finishedAt: '2026-10-25T10:00:00.000Z',
    });
  });

  it('should store a failed command with empty logs', async () => {
    const id = queue.enqueue('terminate');
    queue.complete(id, ['failed', new Map()]);

    expect(queue.activeCommand()).toMatchObject({
      status: 'invalid',
      stdout: '',
      stderr: '',
      finished: true,
    });
  });

  it('should store a stopped command as stopped', async () => {
    const id = queue.enqueue('loop');
    queue.complete(id, ['stopped', new Map()]);

    expect(queue.activeCommand()).toMatchObject({
      status: 'stopped',
      finished: true,
    });
  });

  it('should return correct active command when queue has more than one command', async () => {
    queue.enqueue('hello');
    queue.enqueue('world');

    expect(queue.activeCommand()?.name).toBe('world');
  });

  it('should return empty array when queue is empty', async () => {
    expect(queue.checkHistory()).toStrictEqual([]);
  });

  it('should return correct command history when queue has more than one command', async () => {
    const names = ['hello', 'world', 'terminate'];
    names.forEach((name) => queue.enqueue(name));
    expect(queue.checkHistory()).toStrictEqual(names.map((name) => ({ name })));
  });

  it('should find a command by its request key', async () => {
    queue.enqueue('hello');
    const id = queue.enqueue('world', 'key-1');

    expect(queue.findByKey('key-1')).toMatchObject({ id, name: 'world' });
    expect(queue.findByKey('key-2')).toBeUndefined();
  });

  it('should find a command by each of its request keys', async () => {
    const id = queue.enqueue('world', 'key-1');
    queue.addKey('key-2', id);

    expect(queue.findByKey('key-2')).toMatchObject({ id, name: 'world' });
    expect(queue.checkHistory()).toStrictEqual([{ name: 'world' }]);
  });

  it('should create the directory of the database file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-'));
    try {
      queue.open(join(dir, 'data', 'runner.db'));
      queue.enqueue('hello');
      expect(queue.checkHistory()).toStrictEqual([{ name: 'hello' }]);
      expect(queue.mode()).toBe('file');
    } finally {
      queue.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should close only once', async () => {
    queue.close();
    expect(() => queue.close()).not.toThrow();
  });

  it('should stay in memory without a database file', async () => {
    queue.enqueue('hello');
    queue.open(undefined);

    expect(queue.checkHistory()).toStrictEqual([{ name: 'hello' }]);
    expect(queue.mode()).toBe('memory');
  });

  it('should keep the commands in a database file across restarts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-'));
    const file = join(dir, 'runner.db');
    try {
      queue.open(file);
      const id = queue.enqueue('hello', 'key-1');
      queue.complete(id, ['success', logs('hello world')]);
      queue.close();

      const restarted = new Queue();
      restarted.open(file);
      expect(restarted.checkHistory()).toStrictEqual([{ name: 'hello' }]);
      expect(restarted.findByKey('key-1')).toMatchObject({ finished: true });
      restarted.close();
      queue = new Queue();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
