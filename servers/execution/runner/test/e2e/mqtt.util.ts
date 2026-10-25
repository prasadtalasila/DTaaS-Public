import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { connectAsync, IPublishPacket, MqttClient } from 'mqtt';
import Keyv from 'keyv';
import AppModule from 'src/app.module';
import Config from 'src/config/configuration.service';
import { NotificationDto } from 'src/dto/notify.dto';
import { StateDocumentDto } from 'src/dto/state.dto';
import MqttService from 'src/mqtt/mqtt.service';
import { MqttConfig } from 'src/mqtt/mqtt.config';
import { configFilename } from 'test/utils';

// Starts the runner with the test configuration and, if given, the MQTT
// settings, connected to the broker
export async function startRunner(
  mqtt?: MqttConfig,
): Promise<INestApplication> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication({ logger: false });
  const config = app.get<Config>(Config);
  const options = new Keyv();
  await options.set('configFile', configFilename);
  await config.loadConfig(options);
  if (mqtt !== undefined) {
    jest.spyOn(config, 'getMqtt').mockReturnValue(mqtt);
  }
  // start does nothing without an MQTT configuration. It comes before
  // init, as in main.ts, so that the startup notification is published.
  app.get<MqttService>(MqttService).start();
  await app.init();
  return app;
}

export type Reply = {
  topic: string;
  body: unknown;
  correlationData?: string;
};

// Resolves with the next message on the topic, and with the correlation
// data if one is given, ignoring other messages
export function nextReply(
  client: MqttClient,
  topic: string,
  correlationData?: string,
): Promise<Reply> {
  return new Promise((resolve) => {
    const listener = (
      replyTopic: string,
      payload: Buffer,
      packet: IPublishPacket,
    ) => {
      const received = packet.properties?.correlationData?.toString();
      if (replyTopic !== topic || (correlationData ?? received) !== received) {
        return;
      }
      client.removeListener('message', listener);
      resolve({
        topic: replyTopic,
        body: JSON.parse(payload.toString()),
        correlationData: received,
      });
    };
    client.on('message', listener);
  });
}

export type Notification = { body: NotificationDto; retain: boolean };

// Resolves with the next state notification on the topic whose state
// document passes the check, and whether the broker retained it
export function nextNotification(
  client: MqttClient,
  topic: string,
  check: (document: StateDocumentDto) => boolean,
): Promise<Notification> {
  return new Promise((resolve) => {
    const listener = (
      notifyTopic: string,
      payload: Buffer,
      { retain }: IPublishPacket,
    ) => {
      // an empty payload deletes a retained message
      if (notifyTopic !== topic || payload.length === 0) {
        return;
      }
      const body = JSON.parse(payload.toString()) as NotificationDto;
      if (check(body.data as StateDocumentDto)) {
        client.removeListener('message', listener);
        resolve({ body, retain });
      }
    };
    client.on('message', listener);
  });
}

// Connects a new client and resolves with the first state notification
// it receives on the topic, the one that the broker retained
export async function lateSubscriber(
  url: string,
  protocolVersion: 4 | 5,
  topic: string,
): Promise<Notification> {
  const late = await connectAsync(url, { protocolVersion });
  try {
    const notification = nextNotification(late, topic, () => true);
    await late.subscribeAsync(topic, { qos: 1 });
    return await notification;
  } finally {
    await late.endAsync();
  }
}
