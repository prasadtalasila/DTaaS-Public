import {
  BeforeApplicationShutdown,
  Injectable,
  OnApplicationBootstrap,
  OnModuleInit,
} from '@nestjs/common';
import DescriptorService from '../descriptor.service.js';
import { NotificationDto, NotifyKind } from '../dto/notify.dto.js';
import MqttService from '../mqtt/mqtt.service.js';
import WebhookClient from './webhook.client.js';

// The kinds whose last notification the broker keeps for a Manager
// that subscribes later
const RETAINED: Record<NotifyKind, boolean> = {
  state: true,
  escalation: false,
  presence: true,
};

// Sends the state document whenever it changes, and the notifications
// of other kinds, over MQTT and the webhook
@Injectable()
export default class Notifier
  implements OnModuleInit, OnApplicationBootstrap, BeforeApplicationShutdown
{
  // the last state document sent, without its time
  private last: string | undefined;

  private stopped = false;

  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly descriptor: DescriptorService,
    private readonly mqtt: MqttService,
    private readonly webhook: WebhookClient,
  ) {} // eslint-disable-line no-empty-function

  onModuleInit(): void {
    this.descriptor.onChange(() => this.sendState());
  }

  // The state document at startup
  onApplicationBootstrap(): void {
    this.sendState();
  }

  beforeApplicationShutdown(): void {
    this.stopped = true;
  }

  send(kind: NotifyKind, data: unknown): void {
    if (!this.stopped) {
      const { id } = this.descriptor.describe();
      this.publish({ kind, id, time: new Date().toISOString(), data });
    }
  }

  // A document equal to the last one sent, but for its time, is not
  // sent again
  private sendState(): void {
    if (this.stopped) {
      return;
    }
    const document = this.descriptor.state();
    const content = JSON.stringify({ ...document, time: undefined });
    if (content === this.last) {
      return;
    }
    this.last = content;
    const { id, time } = document;
    this.publish({ kind: 'state', id, time, data: document });
  }

  // Neither transport rejects
  private publish(notification: NotificationDto): void {
    const { kind } = notification;
    void this.mqtt.notify(kind, notification, RETAINED[kind]);
    void this.webhook.post(notification);
  }
}
