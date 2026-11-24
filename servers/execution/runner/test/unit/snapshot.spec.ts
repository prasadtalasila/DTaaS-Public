import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as yaml from 'js-yaml';
import Keyv from 'keyv';
import Config from 'src/config/configuration.service';
import {
  blankedConfig,
  manifestOf,
  runnerVersion,
} from 'src/snapshot/snapshot';
import SnapshotStore, { snapshotName } from 'src/snapshot/store';

const CONFIG = `id: hospital-1
port: 5000
location: scripts
commands: [open]
mqtt:
  url: 'mqtt://localhost:1883'
  topic: dtaas/hospital-1
  password: secret
relationships:
  manager:
    notify:
      url: 'http://localhost:8080/events'
      token: hidden
`;

describe('Snapshot parts', () => {
  it('Should name a snapshot by its time without separators', () => {
    expect(snapshotName('2026-11-23T10:15:02.120Z')).toBe(
      '20261123T101502120Z',
    );
  });

  it('Should blank the MQTT password and the webhook token', () => {
    const text = `${CONFIG}auth:\n  key: keys/hospital-1.key\n`;
    const copy = yaml.load(blankedConfig(text));

    expect(copy).toMatchObject({
      mqtt: { topic: 'dtaas/hospital-1', password: '' },
      relationships: {
        manager: {
          notify: { url: 'http://localhost:8080/events', token: '' },
        },
      },
      auth: { key: 'keys/hospital-1.key' },
    });
  });

  it('Should blank the user and password of the MQTT URL', () => {
    const text = CONFIG.replace('mqtt://localhost', 'mqtt://dt:pw@localhost');

    expect(yaml.load(blankedConfig(text))).toMatchObject({
      mqtt: { url: 'mqtt://localhost:1883', password: '' },
    });
  });

  it('Should blank the whole MQTT URL when it can not be read', () => {
    const text = CONFIG.replace(
      "'mqtt://localhost:1883'",
      "'mqtt://dt:pw@local host'",
    );

    expect(yaml.load(blankedConfig(text))).toMatchObject({
      mqtt: { url: '', password: '' },
    });
  });

  it('Should add no secret that runner.yaml does not have', () => {
    const copy = yaml.load(blankedConfig('id: dt-1\nmqtt: {topic: t}\n'));

    expect(copy).toEqual({ id: 'dt-1', mqtt: { topic: 't' } });
  });

  it('Should write the version of package.json in the manifest', () => {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
    const machine = {
      state: 'open',
      status: 'running' as const,
      entry: 7,
      events: [],
    };
    const time = '2026-11-23T10:15:02.120Z';
    const dtClass = { id: 'urn:dtaas:hospital', version: '1.0.0' };

    expect(runnerVersion()).toBe(version);
    expect(
      manifestOf({ id: 'hospital-1', dtClass, time, seq: 412, machine }),
    ).toEqual({
      format: 1,
      runner: version,
      id: 'hospital-1',
      class: dtClass,
      time,
      seq: 412,
      machine: { state: 'open', entry: 7, status: 'running' },
    });
  });

  it('Should write no class and no machine for a plain twin', () => {
    const manifest = manifestOf({ id: 'dt-1', time: 'now', seq: 0 });

    expect(manifest).toMatchObject({ class: null, machine: null });
  });
});

describe('Snapshot store', () => {
  let dir: string;
  let store: SnapshotStore;

  const snapshot = (name: string, manifest?: object) => {
    mkdirSync(join(dir, name));
    if (manifest !== undefined) {
      writeFileSync(join(dir, name, 'snapshot.json'), JSON.stringify(manifest));
    }
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-snapshots-'));
    store = new SnapshotStore({ directory: dir, given: 'run/snapshots' });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should list the snapshots oldest first, from their manifests', async () => {
    snapshot('20261123T101502120Z', {
      time: '2026-11-23T10:15:02.120Z',
      seq: 9,
    });
    snapshot('20261122T090000000Z', {
      time: '2026-11-22T09:00:00.000Z',
      seq: 4,
    });

    expect(await store.list()).toEqual([
      {
        time: '2026-11-22T09:00:00.000Z',
        seq: 4,
        path: join('run/snapshots', '20261122T090000000Z'),
      },
      {
        time: '2026-11-23T10:15:02.120Z',
        seq: 9,
        path: join('run/snapshots', '20261123T101502120Z'),
      },
    ]);
  });

  it('Should leave out what is no snapshot', async () => {
    snapshot('20261123T101502120Z');
    snapshot('20261123T101502121Z', { time: 'now' });
    snapshot('backup', { time: 'now', seq: 1 });
    writeFileSync(join(dir, '20261123T101502122Z'), '{}');

    expect(await store.list()).toEqual([]);
  });

  it('Should list nothing before the directory exists', async () => {
    const missing = { directory: join(dir, 'none'), given: 'none' };

    expect(await new SnapshotStore(missing).list()).toEqual([]);
  });

  it('Should remove a snapshot', async () => {
    snapshot('20261123T101502120Z', { time: 'now', seq: 1 });

    expect(await store.remove('20261123T101502120Z')).toBe(true);
    expect(await store.list()).toEqual([]);
  });

  it.each(['20261123T101502120Z', '..', 'backup', '20261123T1015021Z'])(
    'Should remove nothing for %s, which is no snapshot',
    async (name) => {
      snapshot('backup', { time: 'now', seq: 1 });

      expect(await store.remove(name)).toBe(false);
    },
  );

  it.each(['..', 'backup', '../20261123T101502120Z'])(
    'Should give no path for the name %s',
    (name) => {
      expect(store.path(name)).toBeUndefined();
    },
  );
});

describe('Snapshot configuration', () => {
  let dir: string;

  const load = async (text: string) => {
    writeFileSync(join(dir, 'runner.yaml'), text);
    const options = new Keyv();
    await options.set('configFile', join(dir, 'runner.yaml'));
    const config = new Config();
    await config.loadConfig(options);
    return config;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-config-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should resolve the directory against runner.yaml', async () => {
    const config = await load(
      `${CONFIG}snapshots:\n  directory: run/snapshots\n  timeout: 5000\n`,
    );

    expect(config.getFile()).toBe(join(dir, 'runner.yaml'));
    expect(config.getSnapshots()).toEqual({
      directory: join(dir, 'run', 'snapshots'),
      given: 'run/snapshots',
    });
    expect(config.getSnapshotTimeout()).toBe(5000);
  });

  it('Should have no directory and a timeout of 30 s by default', async () => {
    const config = await load(CONFIG);

    expect(config.getSnapshots()).toBeUndefined();
    expect(config.getSnapshotTimeout()).toBe(30000);
  });
});
