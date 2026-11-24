import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import DescriptorService from 'src/descriptor.service';
import MqttService from 'src/mqtt/mqtt.service';
import Notifier from 'src/notify/notifier.service';
import WebhookClient from 'src/notify/webhook.client';
import Timeline from 'src/queue.timeline';

const document = (state: string, freeBeds: number | null) => ({
  id: 'hospital-1',
  time: new Date().toISOString(),
  machine: { state, status: 'running' },
  parameters: {},
  properties: { 'free-beds': { value: freeBeds, time: null } },
  command: null,
});

// A notifier over a state document that the test changes, and the
// state notifications that it sent over MQTT
function setup() {
  let current = document('open', null);
  const listeners: Array<() => void> = [];
  const source = {
    timeline: () => new Timeline(),
    describe: () => ({ id: 'hospital-1' }),
    state: () => current,
    stateInterval: () => 1000,
    onChange: (listener: () => void) => listeners.push(listener),
    onEscalation: () => undefined,
    whatIfs: () => ({ onEnd: () => undefined }),
  };
  const notify = jest.fn<MqttService['notify']>(() => Promise.resolve());
  const post = jest.fn<WebhookClient['post']>(() => Promise.resolve());
  const sendOnce = jest.fn<WebhookClient['sendOnce']>(() => Promise.resolve());
  const notifier = new Notifier(
    source as unknown as DescriptorService,
    {
      notify,
      onConnect: () => undefined,
      status: () => 'connected',
    } as unknown as MqttService,
    { post, sendOnce, enabled: () => true } as unknown as WebhookClient,
  );
  notifier.onModuleInit();
  notifier.onApplicationBootstrap();
  const change = (state: string, freeBeds: number | null) => {
    current = document(state, freeBeds);
    listeners.forEach((listener) => listener());
  };
  // what each state notification said of the machine and the property
  const sent = () =>
    notify.mock.calls
      .filter(([kind]) => kind === 'state')
      .map(([, { data }]) => {
        const { machine, properties } = data as ReturnType<typeof document>;
        return [machine.state, properties['free-beds'].value];
      });
  return { notifier, change, sent };
}

describe('Notifier with properties', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-22T10:00:00.000Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('Should hold the changes of property values to one an interval', () => {
    const { change, sent } = setup();
    change('open', 2);
    change('open', 1);

    expect(sent()).toEqual([['open', null]]);

    jest.advanceTimersByTime(1000);

    expect(sent()).toEqual([
      ['open', null],
      ['open', 1],
    ]);

    change('open', 0);
    jest.advanceTimersByTime(1000);

    expect(sent()).toHaveLength(3);
  });

  it('Should send a change of the machine at once, with the held values', () => {
    const { change, sent } = setup();
    change('open', 0);
    change('full', 0);

    expect(sent()).toEqual([
      ['open', null],
      ['full', 0],
    ]);

    jest.advanceTimersByTime(5000);

    expect(sent()).toHaveLength(2);
  });

  it('Should send a property value at once after a quiet interval', () => {
    const { change, sent } = setup();
    jest.advanceTimersByTime(1000);
    change('open', 2);

    expect(sent()).toEqual([
      ['open', null],
      ['open', 2],
    ]);
  });

  it('Should send no held value after the shutdown began', async () => {
    const { notifier, change, sent } = setup();
    change('open', 2);
    await notifier.beforeApplicationShutdown();
    jest.advanceTimersByTime(5000);

    expect(sent()).toEqual([['open', null]]);
  });
});
