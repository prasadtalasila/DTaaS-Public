import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import Keyv from 'keyv';
import Config from 'src/config/configuration.service';

const BASE = 'id: dt-1\nport: 5000\nlocation: .\ncommands: [create]\n';

const OLD = `${BASE}notify:
  url: 'https://manager.example.org/dt-events'
peers:
  - {id: dt-2, topic: dtaas/dt-2}
`;

const NEW = `${BASE}relationships:
  manager:
    notify:
      url: 'https://manager.example.org/dt-events'
  peers:
    - {id: dt-2, topic: dtaas/dt-2}
`;

describe('Layouts of runner.yaml', () => {
  let dir: string;
  let warn: jest.SpiedFunction<Logger['warn']>;

  const load = async (text: string): Promise<Config> => {
    const file = join(dir, 'runner.yaml');
    writeFileSync(file, text);
    const config = new Config();
    const options = new Keyv();
    await options.set('configFile', file);
    await config.loadConfig(options);
    return config;
  };

  const values = (config: Config) => ({
    notify: config.getNotify(),
    peers: config.getPeers(),
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-layout-'));
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('Should read the same values from both layouts', async () => {
    const old = values(await load(OLD));

    expect(old).toEqual(values(await load(NEW)));
    expect(old.notify).toEqual({
      url: 'https://manager.example.org/dt-events',
    });
    expect(old.peers.map(({ id }) => id)).toEqual(['dt-2']);
  });

  it('Should warn once of each old key, and of no new one', async () => {
    await load(NEW);

    expect(warn).not.toHaveBeenCalled();

    await load(OLD);

    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      expect.stringMatching(
        /runner.yaml: notify moved to relationships.manager.notify/,
      ),
      expect.stringMatching(/runner.yaml: peers moved to relationships.peers/),
    ]);
  });

  it('Should refuse a section that is set in both places', async () => {
    const both = `${NEW}peers:\n  - {id: dt-3, topic: dtaas/dt-3}\n`;

    await expect(load(both)).rejects.toThrow(
      /Invalid configuration[\s\S]*peers and relationships.peers are both set/,
    );
  });

  it('Should hold property notifications a second apart by default', async () => {
    const standard = await load(BASE);
    const set = await load(`${BASE}stateInterval: 0\n`);

    expect(standard.getStateInterval()).toBe(1000);
    expect(set.getStateInterval()).toBe(0);
    await expect(load(`${BASE}stateInterval: -1\n`)).rejects.toThrow(
      /at stateInterval/,
    );
  });

  it('Should read the parameter values of the instance, none by default', async () => {
    const plain = await load(BASE);
    const set = await load(
      `${BASE}parameters: {capacity: 1, scope: multi, open: true}\n`,
    );

    expect(plain.getParameters()).toEqual({});
    expect(set.getParameters()).toEqual({
      capacity: 1,
      scope: 'multi',
      open: true,
    });
    await expect(load(`${BASE}parameters: {capacity: [1]}\n`)).rejects.toThrow(
      /at parameters.capacity/,
    );
  });

  it('Should name the new path of a problem in an old key', async () => {
    await expect(load(`${BASE}peers:\n  - {id: dt-2}\n`)).rejects.toThrow(
      /needs a topic or a url[\s\S]*at relationships.peers\[0\]/,
    );
  });
});
