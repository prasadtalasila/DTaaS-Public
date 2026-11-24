import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import DescriptorService from 'src/descriptor.service';
import ExecaManager from 'src/execa-manager.service';
import FsmService from 'src/fsm/fsm.service';
import MqttRequestHandler from 'src/mqtt/mqtt-request.handler';
import Pause from 'src/snapshot/pause';
import { fakeManager, mqttRequest } from './mqtt.fixture';

const SAVED = {
  time: '2026-11-23T10:15:02.120Z',
  seq: 412,
  path: 'snapshots/20261123T101502120Z',
};

function createHandler() {
  const pause = new Pause();
  const transition = jest.fn(() => ({ status: 'accepted', state: 'open' }));
  const snapshots = {
    list: jest.fn(() => Promise.resolve([SAVED])),
    save: jest.fn((_body: object) => Promise.resolve(SAVED)),
  };
  const handler = new MqttRequestHandler(
    fakeManager('success') as unknown as ExecaManager,
    { pause, transition } as unknown as FsmService,
    { snapshots: () => snapshots } as unknown as DescriptorService,
  );
  return { handler, pause, transition, snapshots };
}

const json = (body: unknown) => Buffer.from(JSON.stringify(body));

describe('MQTT snapshot requests', () => {
  it('Should list the snapshots', async () => {
    const { handler } = createHandler();

    expect(
      await handler.handle('snapshots', mqttRequest(Buffer.alloc(0))),
    ).toEqual([SAVED]);
  });

  it.each([
    [Buffer.alloc(0), { stop: false }],
    [json({}), { stop: false }],
    [json({ stop: true }), { stop: true }],
  ])('Should save with the payload %s', async (payload, body) => {
    const { handler, snapshots } = createHandler();

    expect(await handler.handle('save', mqttRequest(payload))).toEqual(SAVED);
    expect(snapshots.save).toHaveBeenCalledWith(body);
  });

  it('Should answer a refused save with the body of its HTTP reply', async () => {
    const { handler, snapshots } = createHandler();
    snapshots.save.mockRejectedValueOnce(
      new ConflictException({ status: 'no database' }),
    );

    expect(await handler.handle('save', mqttRequest(json({})))).toEqual({
      status: 'no database',
    });
  });

  it('Should answer a change during a save with saving', async () => {
    const { handler, pause, transition } = createHandler();
    pause.begin();

    const request = mqttRequest(json({ state: 'open' }));
    expect(await handler.handle('transition', request)).toEqual({
      status: 'saving',
    });
    expect(transition).not.toHaveBeenCalled();
    expect(await handler.handle('health', request)).toMatchObject({
      saving: true,
    });
  });
});
