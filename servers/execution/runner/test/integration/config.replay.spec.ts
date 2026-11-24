import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import Keyv from 'keyv';
import Config from 'src/config/configuration.service';
import MqttRequestHandler from 'src/mqtt/mqtt-request.handler';
import MqttService, { MqttConnect } from 'src/mqtt/mqtt.service';
import WebhookClient from 'src/notify/webhook.client';

const FILE = `id: dt-1
port: 5000
location: .
commands: [create]
mqtt:
  url: 'mqtt://localhost:1883'
  topic: dtaas/dt-1
snapshots:
  directory: ../snapshots
relationships:
  manager:
    notify:
      url: 'https://manager.example.org/dt-events'
  peers:
    - {id: dt-2, topic: dtaas/dt-2}
`;

describe('The configuration of a replay twin', () => {
  let dir: string;

  // The configuration of FILE, as a replay twin at the scale given
  const load = async (scale?: number): Promise<Config> => {
    const options = new Keyv();
    await options.set('configFile', join(dir, 'runner.yaml'));
    if (scale !== undefined) {
      await options.set('replay', scale);
    }
    const config = new Config();
    await config.loadConfig(options);
    return config;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-replay-config-'));
    writeFileSync(join(dir, 'runner.yaml'), FILE);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should reach no broker and no manager, save nothing, and keep the peers', async () => {
    const config = await load(60);

    expect(config.replay()?.scale).toBe(60);
    expect(config.getMqtt()).toBeUndefined();
    expect(config.getNotify()).toBeUndefined();
    expect(config.getSnapshots()).toBeUndefined();
    expect(config.getPeers().map(({ id }) => id)).toEqual(['dt-2']);
  });

  it('Should make no MQTT client and send no webhook', async () => {
    const config = await load(1);
    const connect = jest.fn<MqttConnect>();
    const fetch = jest.spyOn(globalThis, 'fetch');
    const mqtt = new MqttService(config, {} as MqttRequestHandler, connect);
    const webhook = new WebhookClient(config);

    mqtt.start();
    await webhook.post({ kind: 'state', id: 'dt-1', time: null, data: {} });

    expect(connect).not.toHaveBeenCalled();
    expect(mqtt.status()).toBe('disabled');
    expect(webhook.enabled()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it('Should be no replay twin without the option', async () => {
    const config = await load();

    expect(config.replay()).toBeUndefined();
    expect(config.getMqtt()?.topic).toBe('dtaas/dt-1');
    expect(config.getSnapshots()?.given).toBe('../snapshots');
    expect(config.getNotify()?.url).toBe(
      'https://manager.example.org/dt-events',
    );
  });
});
