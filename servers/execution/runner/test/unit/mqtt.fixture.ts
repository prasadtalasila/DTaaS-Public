import { EventEmitter } from 'node:events';
import { jest } from '@jest/globals';
import type { IPublishPacket, MqttClient } from 'mqtt';
import Config from 'src/config/configuration.service';
import MqttRequestHandler from 'src/mqtt/mqtt-request.handler';
import MqttService, { MqttConnect } from 'src/mqtt/mqtt.service';
import { MqttConfig } from 'src/mqtt/mqtt.config';

// An MQTT client that records its calls, for the MQTT service tests
export class FakeClient extends EventEmitter {
  connected = false;

  subscribe = jest.fn();

  publishAsync = jest.fn(
    async (_topic: string, _message: string, _options: unknown) => undefined,
  );

  endAsync = jest.fn(async (_force?: boolean) => undefined);
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
  const config = { getMqtt: () => options } as unknown as Config;
  const handle = jest.fn(
    async (
      _route: string,
      _payload: Buffer,
      _requestKey?: string,
    ): Promise<unknown> => ({
      status: 'success',
    }),
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
