import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { removeDir, result, setup, twinDir } from './snapshot.fixture';

describe('Refused saves', () => {
  let dir: string;

  beforeEach(() => {
    dir = twinDir();
  });

  afterEach(() => {
    removeDir(dir);
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

  it('Should refuse a save while a run of the save script is in progress', async () => {
    const { snapshots, manager, pause } = setup(dir, () =>
      result('success', 0),
    );
    manager.isRunning.mockReturnValue(true);

    const refused = await snapshots.save({ stop: false }).catch((e) => e);

    expect((refused as HttpException).getStatus()).toBe(409);
    expect((refused as HttpException).getResponse()).toEqual({
      status: 'save script running',
    });
    expect(manager.isRunning).toHaveBeenCalledWith('save-ward');
    expect(manager.newCommand).not.toHaveBeenCalled();
    expect(pause.saving).toBe(false);
  });

  it('Should refuse a save script that would run as another account', async () => {
    const { snapshots, config } = setup(dir, () => result('success', 0));
    config.getScriptUser.mockReturnValue({ runDirectory: '/srv/dt/run' });

    const refused = await snapshots.save({ stop: false }).catch((e) => e);

    expect((refused as HttpException).getStatus()).toBe(409);
    expect((refused as HttpException).getResponse()).toEqual({
      status: 'save script of another account',
      message: expect.stringContaining('scripts.user'),
    });
  });

  it('Should save a class without a save script under scripts.user', async () => {
    const { snapshots, config, fsm } = setup(dir, () => result('success', 0));
    config.getScriptUser.mockReturnValue({ runDirectory: '/srv/dt/run' });
    fsm.declared.mockReturnValue({ snapshot: {} });

    expect(await snapshots.save({ stop: false })).toMatchObject({ seq: 0 });
  });
});
