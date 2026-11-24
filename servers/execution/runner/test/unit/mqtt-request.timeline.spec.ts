import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Logger } from '@nestjs/common';
import { Role } from 'src/auth/auth.config';
import DescriptorService from 'src/descriptor.service';
import ExecaManager from 'src/execa-manager.service';
import FsmService from 'src/fsm/fsm.service';
import MqttRequestHandler from 'src/mqtt/mqtt-request.handler';
import Queue from 'src/queue.service';
import { mqttRequest } from './mqtt.fixture';

const json = (body: unknown) => Buffer.from(JSON.stringify(body));

const INPUT = { patient: 'p-7' };

describe('MQTT request handler timeline', () => {
  let queue: Queue;
  let handler: MqttRequestHandler;

  // The timeline request of the principal of the role, if one is given
  const read = (body: unknown, role?: Role) =>
    handler.handle('timeline', {
      ...mqttRequest(json(body)),
      ...(role === undefined ? {} : { principal: { name: role, role } }),
    });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'debug').mockReturnValue(undefined);
    queue = new Queue();
    queue.timeline.record('start', {}, null);
    queue.timeline.record('command', { name: 'admit', input: INPUT }, 'alice');
    handler = new MqttRequestHandler(
      {} as ExecaManager,
      { declared: () => undefined } as unknown as FsmService,
      { timeline: () => queue.timeline } as unknown as DescriptorService,
    );
  });

  afterEach(() => {
    queue.close();
    jest.restoreAllMocks();
  });

  it.each([
    ['without access control', undefined, INPUT],
    ['to a client', 'client' as const, INPUT],
    ['without the input to a manager', 'manager' as const, undefined],
  ])('Should answer the rows %s', async (_, role, input) => {
    expect(await read({}, role)).toEqual([
      { seq: 1, time: expect.any(String), kind: 'start', by: null, data: {} },
      {
        seq: 2,
        time: expect.any(String),
        kind: 'command',
        by: 'alice',
        data: { name: 'admit', input },
      },
    ]);
  });

  it('Should answer the number of rows after a seq', async () => {
    expect(await read({ after: 1, count: true })).toEqual({ count: 1 });
  });

  it('Should refuse a sensor, with the body of the HTTP 403', async () => {
    expect(await read({}, 'sensor')).toEqual({
      message: 'sensor may not call timeline',
      error: 'Forbidden',
      statusCode: 403,
    });
  });

  it('Should refuse a bad query, with the body of the HTTP 400', async () => {
    expect(await read({ limit: 0 })).toEqual({
      message: 'Validation Failed',
      error: 'Bad Request',
      statusCode: 400,
    });
  });
});
