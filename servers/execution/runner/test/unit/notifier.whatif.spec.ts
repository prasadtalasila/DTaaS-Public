import { describe, expect, it, jest } from '@jest/globals';
import DescriptorService from 'src/descriptor.service';
import { WhatIfEndDto } from 'src/dto/whatif.dto';
import MqttService from 'src/mqtt/mqtt.service';
import Notifier from 'src/notify/notifier.service';
import WebhookClient from 'src/notify/webhook.client';
import Timeline from 'src/queue.timeline';
import { EndListener } from 'src/whatif/whatifs';

const ENDED: WhatIfEndDto = {
  id: 57,
  name: 'forecast-beds',
  status: 'valid',
  exitCode: 0,
  result: { 'free-beds': 1 },
};

// A notifier whose descriptor hands out the listener of the what-ifs
function setup() {
  const ends: EndListener[] = [];
  const record = jest.fn<Timeline['record']>(() => 1);
  const source = {
    timeline: () => ({ record }),
    describe: () => ({ id: 'hospital-1' }),
    stateInterval: () => 1000,
    state: () => ({ id: 'hospital-1', time: '' }),
    onChange: () => undefined,
    onEscalation: () => undefined,
    whatIfs: () => ({ onEnd: (listener: EndListener) => ends.push(listener) }),
  };
  const notify = jest.fn<MqttService['notify']>(() => Promise.resolve());
  const post = jest.fn<WebhookClient['post']>(() => Promise.resolve());
  const notifier = new Notifier(
    source as unknown as DescriptorService,
    { notify, onConnect: () => undefined, status: () => 'connected' } as never,
    { post, sendOnce: post, enabled: () => true } as never,
  );
  notifier.onModuleInit();
  return { notifier, ends, notify, post, record };
}

describe('Notifier of what-ifs', () => {
  it('Should send the end of a what-if once, not retained, on both transports', () => {
    const { ends, notify, post, record } = setup();

    ends.forEach((listener) => listener(ENDED));

    const notification = {
      kind: 'whatif' as const,
      id: 'hospital-1',
      time: expect.any(String),
      data: ENDED,
    };
    expect(ends).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('whatif', notification, false);
    expect(post).toHaveBeenCalledWith(notification);
    expect(record).toHaveBeenCalledWith(
      'sent',
      { kind: 'whatif', data: ENDED },
      null,
    );
  });

  it('Should send nothing once the runner shuts down', async () => {
    const { notifier, ends, notify } = setup();
    await notifier.beforeApplicationShutdown();
    notify.mockClear();

    ends.forEach((listener) => listener(ENDED));

    expect(notify).not.toHaveBeenCalled();
  });
});
