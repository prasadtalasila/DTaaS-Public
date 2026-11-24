import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Queue from 'src/queue.service';
import { NO_RESOURCES } from 'src/resources/resources';
import { SCHEMA } from 'src/queue.schema';

describe('What-if runs in the queue', () => {
  let queue: Queue;

  beforeEach(() => {
    queue = new Queue();
  });

  afterEach(() => {
    queue.close();
  });

  it('Should keep a what-if run out of the latest command', () => {
    const live = queue.enqueue('admit');
    queue.enqueue('forecast', undefined, { by: 'cli', mode: 'what-if' });

    expect(queue.activeCommand()?.id).toBe(live);
  });

  it('Should show the mode on a what-if run, and nothing new on others', () => {
    queue.enqueue('admit');
    queue.enqueue('forecast', undefined, { mode: 'what-if' });

    const [live, whatIf] = queue.history({ limit: 10 });
    expect(live).not.toHaveProperty('mode');
    expect(whatIf).toMatchObject({ name: 'forecast', mode: 'what-if' });
  });

  it('Should read a what-if run with its output, and no other run', () => {
    const live = queue.enqueue('admit');
    const id = queue.enqueue('forecast', undefined, { mode: 'what-if' });
    const logs = new Map([['stdout', '{"free":1}']]);
    queue.complete(id, ['success', logs, 0, NO_RESOURCES]);

    expect(queue.whatIfRun(id)).toMatchObject({
      id,
      status: 'valid',
      stdout: '{"free":1}',
    });
    expect(queue.whatIfRun(live)).toBeUndefined();
  });

  it('Should add the mode column to a database of an older version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'queue-whatif-'));
    const file = join(dir, 'old.db');
    const old = new DatabaseSync(file);
    // the commands table of 0.12.0, which has no mode column
    const [commands] = SCHEMA.replace(',\n    mode TEXT', '').split(';');
    old.exec(commands);
    const names = () =>
      old
        .prepare('PRAGMA table_info(commands)')
        .all()
        .map(({ name }) => name);
    expect(names()).not.toContain('mode');

    queue.open(file);
    const id = queue.enqueue('forecast', undefined, { mode: 'what-if' });

    expect(names()).toContain('mode');
    expect(queue.whatIfRun(id)).toMatchObject({ id, name: 'forecast' });
    old.close();
    queue.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
