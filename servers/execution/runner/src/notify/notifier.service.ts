import {
  BeforeApplicationShutdown,
  Injectable,
  OnApplicationBootstrap,
  OnModuleInit,
} from '@nestjs/common';
import DescriptorService from '../descriptor.service.js';
import {
  NotificationDto,
  NotifyKind,
  offlineNotification,
} from '../dto/notify.dto.js';
import MqttService from '../mqtt/mqtt.service.js';
import StateHold from './state-hold.js';
import WebhookClient from './webhook.client.js';

// The kinds whose last notification the broker keeps for a Manager
// that subscribes later
const RETAINED: Record<NotifyKind, boolean> = {
  state: true,
  escalation: false,
  presence: true,
  whatif: false,
};

// Sends the state document whenever it changes, the presence of the
// runner, and the notifications of other kinds, over MQTT and the
// webhook
@Injectable()
export default class Notifier
  implements OnModuleInit, OnApplicationBootstrap, BeforeApplicationShutdown
{
  // the last state document sent, without its time
  private last: string | undefined;

  private stopped = false;

  // holds back the documents in which only property values changed
  private readonly hold = new StateHold(
    () => this.descriptor.stateInterval(),
    () => this.sendState(),
  );

  constructor(
    private readonly descriptor: DescriptorService,
    private readonly mqtt: MqttService,
    private readonly webhook: WebhookClient,
  ) {}

  // The broker keeps only the last presence notice, so the runner
  // announces itself on each connection; the webhook hears it once
  onModuleInit(): void {
    this.descriptor.onChange(() => this.sendState());
    this.mqtt.onConnect(() => this.announce());
    this.descriptor.onEscalation((data) => this.send('escalation', data));
    this.descriptor.whatIfs().onEnd((data) => this.send('whatif', data));
  }

  // The presence and the state document at startup
  onApplicationBootstrap(): void {
    if (!this.stopped) {
      const online = this.record(this.online(), this.webhook.enabled());
      void this.webhook.post(online);
    }
    this.sendState();
  }

  // MqttService publishes the offline notice itself, as its client is
  // already disconnecting when this hook runs; each is a row
  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    this.hold.cancel();
    const { id } = this.descriptor.describe();
    const offline = offlineNotification(id, new Date().toISOString());
    this.record(offline, this.mqttEnabled());
    await this.webhook.sendOnce(this.record(offline, this.webhook.enabled()));
  }

  send(kind: NotifyKind, data: unknown): void {
    if (!this.stopped) {
      const { id } = this.descriptor.describe();
      this.publish({ kind, id, time: new Date().toISOString(), data });
    }
  }

  // A document equal to the last one sent, but for its time, is not
  // sent again, and one that differs in property values only may wait
  private sendState(): void {
    if (this.stopped) {
      return;
    }
    const document = this.descriptor.state();
    const content = JSON.stringify({ ...document, time: undefined });
    const control = JSON.stringify({ ...document, time: 0, properties: 0 });
    if (content === this.last || !this.hold.due(control)) {
      return;
    }
    this.last = content;
    const { id, time } = document;
    this.publish({ kind: 'state', id, time, data: document });
  }

  private announce(): void {
    if (!this.stopped) {
      const online = this.record(this.online(), true);
      void this.mqtt.notify('presence', online, RETAINED.presence);
    }
  }

  private online(): NotificationDto {
    const descriptor = this.descriptor.describe();
    const time = new Date().toISOString();
    const data = { online: true, descriptor };
    return { kind: 'presence', id: descriptor.id, time, data };
  }

  // Neither transport rejects
  private publish(notification: NotificationDto): void {
    const sent = this.mqttEnabled() || this.webhook.enabled();
    const { kind } = this.record(notification, sent);
    void this.mqtt.notify(kind, notification, RETAINED[kind]);
    void this.webhook.post(notification);
  }

  private mqttEnabled(): boolean {
    return this.mqtt.status() !== 'disabled';
  }

  // The timeline holds what is sent over a transport: a state document
  // follows from its rows, so only the row that led to it is named
  private record(notification: NotificationDto, sent: boolean) {
    if (sent) {
      const { kind, data } = notification;
      const timeline = this.descriptor.timeline();
      const row = kind === 'state' ? { cause: timeline.lastCause() } : { data };
      timeline.record('sent', { kind, ...row }, null);
    }
    return notification;
  }
}
