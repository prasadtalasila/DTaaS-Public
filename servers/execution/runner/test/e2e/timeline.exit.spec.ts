import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import supertest from 'supertest';
import { TimelineRow } from 'src/dto/timeline.dto';
import ExecaManager from 'src/execa-manager.service';
import { digitalTwin, post, settled, startRunner } from './fsm.util';

// loop runs until it is stopped; again stops and restarts it, and leave
// moves on while it runs
const DEFINITION = `
events: [again, leave, back]
states:
  loop:
    transitions:
      again: {state: loop, stop: true}
      leave: create
  create:
    transitions:
      back: loop`;

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

const pause = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 50);
  });

const rowsOf = async (app: INestApplication): Promise<TimelineRow[]> =>
  (await supertest(app.getHttpServer()).get('/timeline')).body;

const has = (rows: TimelineRow[], kind: string, entry: number) =>
  rows.some((row) => row.kind === kind && row.data.entry === entry);

// Waits until the script of the entry runs, which a stop transition
// starts only once the script of the entry before has exited
async function running(app: INestApplication, entry: number): Promise<void> {
  const rows = await rowsOf(app);
  const before = entry === 1 || has(rows, 'exit', entry - 1);
  const ready = has(rows, 'entry', entry) && before;
  if (!ready || !app.get(ExecaManager).isRunning('loop')) {
    await pause();
    await running(app, entry);
  }
}

describe('Timeline exits end-to-end tests', () => {
  let dir: string;
  let app: INestApplication;
  let rows: TimelineRow[];

  // A stop transition, a transition that leaves loop running, and two
  // stop requests: of that stale script, and of the current one
  beforeAll(async () => {
    dir = digitalTwin(DEFINITION, ['loop']);
    app = await startRunner(join(dir, 'runner.yaml'));
    await post(app, '/fsm/transition', { state: 'loop' });
    await running(app, 1);
    await post(app, '/fsm/event', { event: 'again' });
    await running(app, 2);
    await post(app, '/fsm/event', { event: 'leave' });
    await settled(app, 'create');
    await post(app, '/stop', { name: 'loop' });
    await post(app, '/fsm/event', { event: 'back' });
    await running(app, 4);
    await post(app, '/stop', { name: 'loop' });
    rows = await rowsOf(app);
  }, TIMEOUT);

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should follow each entry with one exit of its script', () => {
    const exits = rows
      .filter(({ kind }) => kind === 'entry')
      .map(({ seq, data }) =>
        rows.filter(
          (row) =>
            row.kind === 'exit' &&
            row.data.entry === data.entry &&
            row.seq > seq,
        ),
      );

    expect(exits.map((ends) => ends.length)).toEqual([1, 1, 1, 1]);
    expect(exits.map(([{ data }]) => data)).toEqual([
      { state: 'loop', entry: 1, status: 'stopped', run: 1 },
      { state: 'loop', entry: 2, status: 'stopped', run: 2 },
      { state: 'create', entry: 3, status: 'valid', run: 3 },
      { state: 'loop', entry: 4, status: 'stopped', run: 4 },
    ]);
  });
});
