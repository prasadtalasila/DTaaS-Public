import { afterEach, describe, expect, it, jest } from '@jest/globals';
import DescriptorService from 'src/descriptor.service';
import { NotificationDto } from 'src/dto/notify.dto';
import MqttService from 'src/mqtt/mqtt.service';
import Notifier from 'src/notify/notifier.service';
import WebhookClient from 'src/notify/webhook.client';

const NOW = new Date('2026-10-25T10:00:00.000Z');

const document = (time: string, state: string | null = null) => ({
  id: 'hospital-1',
  time,
  machine: state === null ? null : { state, status: 'running' },
  parameters: {},
  command: null,
});

// A notifier over fakes of its sources and transports; change() makes
// the state document the given one and signals the change
function setup() {
  let current = document('2026-10-25T09:59:58.000Z');
  const listeners: Array<() => void> = [];
  const descriptor = {
    describe: () => ({ id: 'hospital-1' }),
    state: () => current,
    onChange: (listener: () => void) => listeners.push(listener),
  };
  const notify = jest.fn<MqttService['notify']>(() => Promise.resolve());
  const post = jest.fn<WebhookClient['post']>(() => Promise.resolve());
  const notifier = new Notifier(
    descriptor as unknown as DescriptorService,
    { notify } as unknown as MqttService,
    { post } as unknown as WebhookClient,
  );
  notifier.onModuleInit();
  const change = (next: ReturnType<typeof document>) => {
    current = next;
    listeners.forEach((listener) => listener());
  };
  return { notifier, notify, post, change };
}

describe('Notifier', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('Should send the state document at startup, retained', () => {
    const { notifier, notify, post } = setup();

    notifier.onApplicationBootstrap();

    const envelope: NotificationDto = {
      kind: 'state',
      id: 'hospital-1',
      time: '2026-10-25T09:59:58.000Z',
      data: document('2026-10-25T09:59:58.000Z'),
    };
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('state', envelope, true);
    expect(post).toHaveBeenCalledWith(envelope);
  });

  it('Should skip a document that changed only its time', () => {
    const { notifier, notify, change } = setup();
    notifier.onApplicationBootstrap();

    change(document('2026-10-25T09:59:59.000Z'));
    expect(notify).toHaveBeenCalledTimes(1);

    change(document('2026-10-25T10:00:00.000Z', 'create'));
    change(document('2026-10-25T10:00:01.000Z', 'create'));
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1][1]).toMatchObject({
      time: '2026-10-25T10:00:00.000Z',
      data: { machine: { state: 'create' } },
    });
  });

  it.each([
    ['escalation', false],
    ['presence', true],
  ] as const)('Should send a %s notification, retained: %p', (kind, retain) => {
    jest.useFakeTimers({ now: NOW });
    const { notifier, notify, post } = setup();

    notifier.send(kind, { online: true });

    const envelope = {
      kind,
      id: 'hospital-1',
      time: '2026-10-25T10:00:00.000Z',
      data: { online: true },
    };
    expect(notify).toHaveBeenCalledWith(kind, envelope, retain);
    expect(post).toHaveBeenCalledWith(envelope);
  });

  it('Should send nothing once shutdown begins', () => {
    const { notifier, notify, post, change } = setup();

    notifier.beforeApplicationShutdown();
    notifier.onApplicationBootstrap();
    change(document('2026-10-25T10:00:00.000Z', 'create'));
    notifier.send('escalation', {});

    expect(notify).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
