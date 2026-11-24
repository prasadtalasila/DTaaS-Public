import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Keyv from 'keyv';
import Config from 'src/config/configuration.service';

const BASE = 'id: dt-1\nport: 5000\nlocation: .\ncommands: [create]\n';

const NOTIFY = "url: 'https://manager.example.org/dt-events'";

const PEERS = '- {id: dt-2, topic: dtaas/dt-2}';

const RELATIONSHIPS = `${BASE}relationships:
  manager:
    notify: {${NOTIFY}}
  peers:
    ${PEERS}
`;

describe('Values of runner.yaml', () => {
  let dir: string;

  const load = async (text: string): Promise<Config> => {
    const file = join(dir, 'runner.yaml');
    writeFileSync(file, text);
    const config = new Config();
    const options = new Keyv();
    await options.set('configFile', file);
    await config.loadConfig(options);
    return config;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-values-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should read the manager and the peers under relationships', async () => {
    const config = await load(RELATIONSHIPS);

    expect(config.getNotify()).toEqual({
      url: 'https://manager.example.org/dt-events',
    });
    expect(config.getPeers().map(({ id }) => id)).toEqual(['dt-2']);
  });

  it.each([
    ['peers', `peers:\n  ${PEERS}\n`, 'relationships.peers'],
    ['notify', `notify: {${NOTIFY}}\n`, 'relationships.manager.notify'],
  ])(
    'Should refuse %s at the top, which 0.12 removed, and name its new path',
    async (key, text, path) => {
      await expect(load(`${BASE}${text}`)).rejects.toThrow(
        `Invalid configuration in ${join(dir, 'runner.yaml')}:\n` +
          `✖ Unrecognized key: "${key}"\n` +
          `✖ ${key} moved to ${path} in 0.11`,
      );
    },
  );

  it('Should name the new path of both old keys', async () => {
    await expect(
      load(`${BASE}notify: {${NOTIFY}}\npeers:\n  ${PEERS}\n`),
    ).rejects.toThrow(
      /Unrecognized keys: "notify", "peers"\n✖ notify moved to relationships.manager.notify in 0.11\n✖ peers moved to relationships.peers in 0.11$/,
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
});
