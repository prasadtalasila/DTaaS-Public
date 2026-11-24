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
import { CommandRefused } from 'src/dto/command.dto';
import { CommandOptions } from 'src/interfaces/command.interface';
import { NO_RESOURCES } from 'src/resources/resources';
import { mqttRequest } from './mqtt.fixture';
import Pause from 'src/snapshot/pause';

const json = (body: unknown) => Buffer.from(JSON.stringify(body));

const INPUT = { patient: 'p-7' };

// The rows of the timeline, without their seq and time
const rowsOf = (queue: Queue) =>
  queue.timeline
    .rows({ after: 0, limit: 100, count: false })
    .map(({ kind, by, data }) => [kind, by, data]);

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
      {
        pause: new Pause(),
        declared: () => undefined,
      } as unknown as FsmService,
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
    ['to an operator', 'operator' as const, INPUT],
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

describe('MQTT request handler rows of commands and stops', () => {
  let queue: Queue;
  let handler: MqttRequestHandler;

  // Names run 7 for a command it starts, and refuses any other
  const manager = {
    newCommand: jest.fn(
      (name: string, _key?: string, options?: CommandOptions) => {
        if (name !== 'admit') {
          return Promise.reject(new CommandRefused('command running'));
        }
        options?.onRun?.(7);
        return Promise.resolve(['success', new Map(), 0, NO_RESOURCES]);
      },
    ),
    stop: jest.fn((name?: string) => Promise.resolve(name ? [name] : [])),
  };

  // The request of the client alice on the route
  const send = (route: 'execute' | 'stop', body: unknown) =>
    handler.handle(route, {
      ...mqttRequest(json(body)),
      principal: { name: 'alice', role: 'client' },
    });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'debug').mockReturnValue(undefined);
    queue = new Queue();
    handler = new MqttRequestHandler(
      manager as unknown as ExecaManager,
      {
        pause: new Pause(),
        declared: () => undefined,
        environment: () => ({}),
      } as unknown as FsmService,
      { timeline: () => queue.timeline } as unknown as DescriptorService,
    );
  });

  afterEach(() => {
    queue.close();
    jest.restoreAllMocks();
  });

  it('Should write a row of each command, with its run or none', async () => {
    await send('execute', { name: 'admit', input: INPUT });
    await send('execute', { name: 'discharge', input: INPUT });

    expect(rowsOf(queue)).toEqual([
      ['command', 'alice', { name: 'admit', input: INPUT, run: 7 }],
      ['command', 'alice', { name: 'discharge', input: INPUT, run: null }],
    ]);
  });

  it('Should write a row of each stop request', async () => {
    await send('stop', { name: 'admit' });
    await send('stop', {});

    expect(rowsOf(queue)).toEqual([
      ['stop', 'alice', { name: 'admit' }],
      ['stop', 'alice', { name: null }],
    ]);
  });
});
