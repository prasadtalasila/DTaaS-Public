import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Keyv from 'keyv';
import Config from 'src/config/configuration.service';
import { placementProblems } from 'src/snapshot/placement';

const BASE = 'id: dt-1\nport: 5000\nlocation: scripts\ncommands: []\n';

describe('Placement of snapshots', () => {
  it.each([
    ['/srv/dt/snapshots', true],
    ['/srv/dt/scripts/snapshots', false],
    ['/srv/dt/scripts', false],
    ['/srv/dt/scripts-old', true],
    ['/srv/dt/scripts/..x', false],
  ])('Should judge the directory %s beside scripts: fine %s', (dir, fine) => {
    const problems = placementProblems({
      location: '/srv/dt/scripts',
      snapshots: dir,
    });

    expect(problems.length === 0).toBe(fine);
  });

  it('Should refuse a state machine file named runner.yaml', () => {
    expect(
      placementProblems({
        location: '/srv/dt/scripts',
        stateMachine: '/srv/dt/class/runner.yaml',
        snapshots: '/srv/dt/snapshots',
      }),
    ).toEqual([
      '✖ stateMachine /srv/dt/class/runner.yaml is named runner.yaml, the name of the copy of the configuration in a snapshot',
    ]);
  });

  it('Should check nothing without a snapshot directory', () => {
    expect(
      placementProblems({
        location: '/srv/dt',
        stateMachine: '/srv/dt/runner.yaml',
      }),
    ).toEqual([]);
  });
});

describe('Placement of snapshots in runner.yaml', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-placement-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should refuse a snapshot directory inside location, naming both', async () => {
    const file = join(dir, 'runner.yaml');
    writeFileSync(file, `${BASE}snapshots:\n  directory: scripts/snapshots\n`);
    const options = new Keyv();
    await options.set('configFile', file);

    await expect(new Config().loadConfig(options)).rejects.toThrow(
      `Invalid configuration in ${file}:\n✖ snapshots.directory ${join(dir, 'scripts', 'snapshots')} is inside location ${join(dir, 'scripts')}`,
    );
  });
});
