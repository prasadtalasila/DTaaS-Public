import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import Config from 'src/config/configuration.service';
import FsmService from 'src/fsm/fsm.service';
import { CommandOptions } from 'src/interfaces/command.interface';
import { RunOutcome } from 'src/interfaces/runner.interface';
import Queue from 'src/queue.service';
import Pause from 'src/snapshot/pause';
import Snapshots from 'src/snapshot/snapshots';
import { UNMEASURED } from 'test/utils';

export type Run = (
  name: string,
  key?: string,
  options?: CommandOptions,
) => unknown;

export const result = (outcome: RunOutcome, code: number | null) =>
  Promise.resolve([
    outcome,
    new Map([['stderr', 'no ward']]),
    code,
    UNMEASURED,
  ]);

// Snapshots of a twin whose class names the save script, with a real
// database file and a fake state machine and manager
export function setup(dir: string, run: Run, database = true) {
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
    getScriptUser: jest.fn((): unknown => undefined),
  };
  const manager = {
    newCommand: jest.fn(run),
    stop: jest.fn((_name?: string) => Promise.resolve<string[]>([])),
    isRunning: jest.fn((_name: string) => false),
  };
  const fsm = {
    pause: new Pause(),
    manager,
    declared: jest.fn(() => ({ snapshot: { save: 'save-ward' } as object })),
    check: () => undefined,
    environment: () => ({ DT_ID: 'dt-1' }),
  };
  const snapshots = new Snapshots(
    config as unknown as Config,
    fsm as unknown as FsmService,
    queue,
  );
  return { queue, manager, fsm, config, pause: fsm.pause, snapshots };
}

// A directory with a runner.yaml, for one test
export function twinDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runner-save-'));
  writeFileSync(join(dir, 'runner.yaml'), 'id: dt-1\n');
  return dir;
}

export const removeDir = (dir: string) =>
  rmSync(dir, { recursive: true, force: true });
