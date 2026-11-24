import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import Config from 'src/config/configuration.service';
import FsmService from 'src/fsm/fsm.service';
import Queue from 'src/queue.service';
import { differences } from 'src/snapshot/differences';
import { checkClass, readManifest } from 'src/snapshot/manifest';
import { openTwin } from 'src/snapshot/reinstate';

const WARD = { id: 'urn:dtaas:ward', version: '1.0.0' };

// What reinstating reads of the configuration
const fakeConfig = (dir: string, values: Record<string, unknown> = {}) =>
  ({
    getFile: () => join(dir, 'runner.yaml'),
    getDatabase: () => join(dir, 'run', 'dt.db'),
    getScriptUser: () => undefined,
    getParameters: () => ({}),
    getStateMachine: () => undefined,
    getLocation: () => join(dir, 'scripts'),
    ...values,
  }) as unknown as Config;

describe('Reinstating', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-reinstate-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const manifest = (text: string) =>
    writeFileSync(join(dir, 'snapshot.json'), text);

  it('Should refuse a restore script under scripts.user, and say what to do', async () => {
    const services = new Map<unknown, unknown>([
      [Config, fakeConfig(dir, { getScriptUser: () => ({ user: 'dt' }) })],
      [FsmService, { declared: () => ({ snapshot: { restore: 'back' } }) }],
      [Queue, {}],
    ]);
    const app = { get: (token: unknown) => services.get(token) };
    manifest(
      JSON.stringify({ format: 1, id: 'dt', class: null, time: 't', seq: 1 }),
    );

    await expect(
      openTwin(app as unknown as INestApplication, dir),
    ).rejects.toThrow(
      `Can not reinstate with ${join(dir, 'runner.yaml')}: with scripts.user the restore script runs as another account`,
    );
  });

  it('Should refuse a manifest that is no JSON', async () => {
    manifest('{');

    await expect(readManifest(dir)).rejects.toThrow('it is no JSON');
  });

  it('Should refuse a manifest of format 1 without its fields', async () => {
    manifest('{"format": 1, "id": 3}');

    await expect(readManifest(dir)).rejects.toThrow(
      `Can not reinstate from ${join(dir, 'snapshot.json')}: ✖`,
    );
  });

  it('Should refuse a manifest that is not an object', async () => {
    manifest('null');

    await expect(readManifest(dir)).rejects.toThrow(
      'format undefined is not 1',
    );
  });

  it('Should match a snapshot without a class to a runner without a state machine file only', () => {
    expect(() => checkClass(dir, null, {})).not.toThrow();
    expect(() => checkClass(dir, WARD, {})).toThrow(
      'the snapshot is of class urn:dtaas:ward, and the runner without a state machine file is without a class',
    );
    expect(() => checkClass(dir, WARD, { dtClass: WARD })).not.toThrow();
  });

  it('Should warn of another version of the class, and of a state machine file that only one side has', async () => {
    writeFileSync(join(dir, 'runner.yaml'), 'stateMachine: ward.fsm.yaml\n');
    const config = fakeConfig(dir);

    const found = await differences(dir, WARD, {
      config,
      dtClass: { ...WARD, version: '2.0.0' },
    });

    expect(found).toEqual([
      'The snapshot is of version 1.0.0 of class urn:dtaas:ward, and the state machine file of version 2.0.0',
      `The state machine file (none) is not the same as the copy ${join(dir, 'ward.fsm.yaml')} in the snapshot`,
    ]);
  });

  it('Should find no difference in a snapshot without the copies', async () => {
    mkdirSync(join(dir, 'scripts'));

    expect(await differences(dir, null, { config: fakeConfig(dir) })).toEqual(
      [],
    );
  });
});
