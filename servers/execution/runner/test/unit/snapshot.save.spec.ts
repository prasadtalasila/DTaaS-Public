import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { HttpException } from '@nestjs/common';
import Config from 'src/config/configuration.service';
import FsmService from 'src/fsm/fsm.service';
import { CommandOptions } from 'src/interfaces/command.interface';
import { RunOutcome } from 'src/interfaces/runner.interface';
import Queue from 'src/queue.service';
import Pause from 'src/snapshot/pause';
import Snapshots from 'src/snapshot/snapshots';
import { UNMEASURED } from 'test/utils';

type Run = (name: string, key?: string, options?: CommandOptions) => unknown;

const result = (outcome: RunOutcome, code: number | null) =>
  Promise.resolve([
    outcome,
    new Map([['stderr', 'no ward']]),
    code,
    UNMEASURED,
  ]);

// Snapshots of a twin whose class names the save script, with a real
// database file and a fake state machine and manager
function setup(dir: string, run: Run, database = true) {
  const queue = new Queue();
  if (database) {
    queue.open(join(dir, 'dt.db'));
  }
  mkdirSync(join(dir, 'scripts'));
  const config = {
    getSnapshots: () => ({ directory: join(dir, 'snapshots'), given: 'snaps' }),
    getSnapshotTimeout: () => 50,
    getFile: () => join(dir, 'runner.yaml'),
    getStateMachine: () => undefined,
    getLocation: () => join(dir, 'scripts'),
    getId: () => 'dt-1',
  } as unknown as Config;
  const manager = {
    newCommand: jest.fn(run),
    stop: jest.fn((_name?: string) => Promise.resolve<string[]>([])),
  };
  const fsm = {
    pause: new Pause(),
    manager,
    declared: jest.fn(() => ({ snapshot: { save: 'save-ward' } as object })),
    check: () => undefined,
    environment: () => ({ DT_ID: 'dt-1' }),
  };
  const snapshots = new Snapshots(config, fsm as unknown as FsmService, queue);
  return { queue, manager, fsm, pause: fsm.pause, snapshots };
}

describe('Saving a twin', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-save-'));
    writeFileSync(join(dir, 'runner.yaml'), 'id: dt-1\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should run the save script with its directory, as the caller', async () => {
    const { snapshots, manager } = setup(dir, () => result('success', 0));

    const { path } = await snapshots.save({ stop: false });

    const files = join(dir, 'snapshots', basename(path), 'files');
    const [name, key, options] = manager.newCommand.mock.calls[0];
    expect([name, key]).toEqual(['save-ward', undefined]);
    expect(options?.env).toEqual({ DT_ID: 'dt-1', DT_SNAPSHOT_DIR: files });
    expect(existsSync(files)).toBe(true);
  });

  it('Should end at the row before the snapshot row', async () => {
    const { snapshots, queue } = setup(dir, () => result('success', 0));
    queue.timeline.record('start', {}, null);

    const { seq, time, path } = await snapshots.save({ stop: false });

    const name = basename(path);
    const copy = new DatabaseSync(join(dir, 'snapshots', name, 'state.db'));
    const last = copy.prepare('SELECT MAX(seq) AS seq FROM timeline').get();
    copy.close();
    const [row] = queue.timeline.rows({ after: seq, limit: 10, count: false });
    expect(last?.seq).toBe(seq);
    expect(row).toMatchObject({ kind: 'snapshot', data: { time, name } });
  });

  it('Should remove the directory and go on when the save script fails', async () => {
    const { snapshots, pause } = setup(dir, () => result('failed', 1));

    const failed = await snapshots.save({ stop: true }).catch((error) => error);

    expect((failed as HttpException).getStatus()).toBe(500);
    expect((failed as HttpException).getResponse()).toEqual({
      status: 'failed',
      result: {
        exitCode: 1,
        stdout: '',
        stderr: 'no ward',
        resources: UNMEASURED,
      },
    });
    expect(readdirSync(join(dir, 'snapshots'))).toEqual([]);
    expect(pause.saving).toBe(false);
  });

  it('Should stop a save script that passes the timeout', async () => {
    let stopped: () => void = () => undefined;
    const { snapshots, manager } = setup(
      dir,
      () =>
        new Promise((resolve) => {
          stopped = () => resolve(['stopped', new Map(), null, UNMEASURED]);
        }),
    );
    manager.stop.mockImplementation(() => {
      stopped();
      return Promise.resolve(['save-ward']);
    });

    const failed = await snapshots
      .save({ stop: false })
      .catch((error) => error);

    expect(manager.stop).toHaveBeenCalledWith('save-ward');
    expect((failed as HttpException).getResponse()).toMatchObject({
      status: 'stopped',
    });
    expect(readdirSync(join(dir, 'snapshots'))).toEqual([]);
  });

  it('Should stop the scripts and shut down after a save with stop, still paused', async () => {
    const { snapshots, pause, manager } = setup(dir, () =>
      result('success', 0),
    );
    const stop = jest.fn(() => Promise.resolve());
    snapshots.onStop(stop);

    await snapshots.save({ stop: true });

    expect(stop).not.toHaveBeenCalled();
    await new Promise(setImmediate);
    expect(manager.stop).toHaveBeenCalledWith();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(pause.saving).toBe(true);
  });

  it('Should refuse a runner without a database file', async () => {
    const { snapshots } = setup(dir, () => result('success', 0), false);

    const refused = await snapshots
      .save({ stop: false })
      .catch((error) => error);

    expect((refused as HttpException).getStatus()).toBe(409);
    expect((refused as HttpException).getResponse()).toEqual({
      status: 'no database',
    });
  });

  it('Should answer 404 for a snapshot that is not there', async () => {
    const { snapshots } = setup(dir, () => result('success', 0));

    const missing = await snapshots
      .remove('20261123T101502120Z')
      .catch((error) => error);

    expect((missing as HttpException).getStatus()).toBe(404);
  });

  it('Should write no files without a save script', async () => {
    const { snapshots, manager, fsm } = setup(dir, () => result('success', 0));
    fsm.declared.mockReturnValue({ snapshot: {} });

    const { path } = await snapshots.save({ stop: false });

    expect(manager.newCommand).not.toHaveBeenCalled();
    expect(readdirSync(join(dir, 'snapshots', basename(path)))).not.toContain(
      'files',
    );
  });

  it('Should go on when the shutdown after a save fails', async () => {
    const { snapshots } = setup(dir, () => result('success', 0));
    const stop = jest.fn(() => Promise.reject(new Error('closed already')));
    snapshots.onStop(stop);

    await snapshots.save({ stop: true });
    await new Promise(setImmediate);

    expect(stop).toHaveBeenCalledTimes(1);
  });
});
