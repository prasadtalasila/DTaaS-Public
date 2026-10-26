import { EventEmitter } from 'node:events';
import { jest } from '@jest/globals';
import type { IPublishPacket, MqttClient } from 'mqtt';
import Config from 'src/config/configuration.service';
import MqttRequestHandler from 'src/mqtt/mqtt-request.handler';
import MqttService, { MqttConnect } from 'src/mqtt/mqtt.service';
import { MqttConfig } from 'src/mqtt/mqtt.config';
import { RunOptions, RunOutcome } from 'src/interfaces/runner.interface';

// An MQTT client that records its calls, for the MQTT service tests
export class FakeClient extends EventEmitter {
  connected = false;

  subscribe = jest.fn();

  publishAsync = jest.fn(
    (_topic: string, _message: string, _options: unknown) =>
      Promise.resolve(undefined),
  );

  endAsync = jest.fn((_force?: boolean) => Promise.resolve(undefined));

  stream = { destroy: jest.fn() };
}

export const mqttConfig: MqttConfig = {
  url: 'mqtt://user:secret@localhost:1883',
  topic: 'dtaas/runner',
  username: 'user',
  password: 'secret',
  protocolVersion: 5,
};

export function setup(options: MqttConfig | undefined) {
  const client = new FakeClient();
  const connect = jest.fn<MqttConnect>(() => client as unknown as MqttClient);
  const config = {
    getMqtt: () => options,
    getId: () => 'hospital-1',
  } as unknown as Config;
  const handle = jest.fn(
    (
      _route: string,
      _payload: Buffer,
      _requestKey?: string,
    ): Promise<unknown> => Promise.resolve({ status: 'success' }),
  );
  const handler = { handle } as unknown as MqttRequestHandler;
  const service = new MqttService(config, handler, connect);
  return { client, connect, handle, service };
}

export const packet = (properties?: IPublishPacket['properties']) =>
  ({ properties }) as IPublishPacket;

// The service answers asynchronously, so wait for the reply to go out.
// A received packet carries its topic, as in mqtt.js.
export const message = async (
  client: FakeClient,
  topic: string,
  payload: Buffer,
  received: IPublishPacket,
) => {
  client.emit('message', topic, payload, { ...received, topic });
  await new Promise(setImmediate);
};

export const status = {
  name: 'create',
  status: 'valid',
  logs: { stdout: 'hello world', stderr: '' },
  exitCode: 0,
};

// An ExecaManager whose commands all end with the outcome, for the
// MQTT request handler tests
export const fakeManager = (outcome: RunOutcome) => ({
  newCommand: jest.fn(
    (_name: string, _requestKey?: string, _options?: RunOptions) =>
      Promise.resolve([outcome, new Map(), null]),
  ),
  checkStatus: jest.fn(() => status),
  checkHistory: jest.fn(() => [{ name: 'create' }]),
  databaseMode: jest.fn(() => 'file'),
  stop: jest.fn((_name?: string) => Promise.resolve(['create'])),
});

export const dt = {
  id: 'hospital-1',
  attributes: { city: 'Aarhus' },
  commands: ['create'],
  stateMachine: true,
  manager: { commands: [] },
};

export const stateDocument = {
  id: 'hospital-1',
  time: '2026-10-25T10:00:00.000Z',
  machine: null,
  parameters: {},
  command: null,
};

// A DescriptorService, for the MQTT request handler tests
export const fakeDescriptor = () => ({
  describe: jest.fn(() => dt),
  state: jest.fn(() => stateDocument),
});
