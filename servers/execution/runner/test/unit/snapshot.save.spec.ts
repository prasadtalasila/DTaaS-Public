import { existsSync, readdirSync, statSync } from 'node:fs';
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
import { RunOutcome } from 'src/interfaces/runner.interface';
import { UNMEASURED } from 'test/utils';
import { removeDir, result, setup, twinDir } from './snapshot.fixture';

describe('Saving a twin', () => {
  let dir: string;

  beforeEach(() => {
    dir = twinDir();
  });

  afterEach(() => {
    removeDir(dir);
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

  it('Should write no files without a save script', async () => {
    const { snapshots, manager, fsm } = setup(dir, () => result('success', 0));
    fsm.declared.mockReturnValue({ snapshot: {} });

    const { path } = await snapshots.save({ stop: false });

    expect(manager.newCommand).not.toHaveBeenCalled();
    expect(readdirSync(join(dir, 'snapshots', basename(path)))).not.toContain(
      'files',
    );
  });

  it('Should let the twin go on when the shutdown after a save fails', async () => {
    let finish: (outcome: RunOutcome) => void = () => undefined;
    const { snapshots, pause } = setup(dir, () => result('success', 0));
    const stop = jest.fn(() => Promise.reject(new Error('closed already')));
    snapshots.onStop(stop);
    const held = pause.hold(
      new Promise<RunOutcome>((resolve) => {
        finish = resolve;
      }),
    );

    await snapshots.save({ stop: true });
    finish('success');
    await new Promise(setImmediate);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(pause.saving).toBe(false);
    expect(await held).toBe('success');
  });

  (process.platform === 'win32' ? it.skip : it)(
    'Should let only the account of the runner read the snapshot',
    async () => {
      const { snapshots } = setup(dir, () => result('success', 0));

      const { path } = await snapshots.save({ stop: false });

      const { mode } = statSync(join(dir, 'snapshots', basename(path)));
      expect(mode & 0o777).toBe(0o700);
    },
  );
});
