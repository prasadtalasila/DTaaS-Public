import { beforeEach, describe, expect, it } from '@jest/globals';
import DescriptorService from 'src/descriptor.service';
import ExecaManager from 'src/execa-manager.service';
import FsmService from 'src/fsm/fsm.service';
import Properties from 'src/fsm/properties';
import MqttRequestHandler from 'src/mqtt/mqtt-request.handler';
import { mqttRequest } from './mqtt.fixture';

const DECLARED = new Map([
  ['free-beds', { type: 'integer' as const, unit: 'beds' }],
]);

const STORE = { saveProperties: () => undefined, storedProperties: () => [] };

const NO_MACHINE = { status: 'no state machine', state: null };

const json = (body: unknown) => Buffer.from(JSON.stringify(body));

describe('MQTT request handler properties', () => {
  let properties: Properties;
  let handler: MqttRequestHandler;

  beforeEach(() => {
    properties = new Properties();
    properties.load(DECLARED, STORE);
    handler = new MqttRequestHandler(
      {} as ExecaManager,
      { declared: () => undefined } as unknown as FsmService,
      { properties: () => properties } as unknown as DescriptorService,
    );
  });

  it('Should return the properties', async () => {
    const body = await handler.handle(
      'properties',
      mqttRequest(Buffer.alloc(0)),
    );

    expect(body).toEqual({
      'free-beds': {
        value: null,
        time: null,
        by: null,
        type: 'integer',
        unit: 'beds',
      },
    });
  });

  it('Should write a value, by the principal, and return the properties', async () => {
    const request = {
      ...mqttRequest(json({ 'free-beds': 1 })),
      principal: { name: 'ward-gateway', role: 'sensor' as const },
    };
    const body = await handler.handle('set-properties', request);

    expect(body).toMatchObject({
      'free-beds': { value: 1, by: 'ward-gateway' },
    });
  });

  it('Should refuse a manager the write, with the body of the HTTP 403', async () => {
    const request = {
      ...mqttRequest(json({ 'free-beds': 1 })),
      principal: { name: 'manager-1', role: 'manager' as const },
    };

    expect(await handler.handle('set-properties', request)).toEqual({
      message: 'manager may not call set-properties',
      error: 'Forbidden',
      statusCode: 403,
    });
    expect(properties.values()['free-beds'].value).toBeNull();
  });

  it('Should return the HTTP 400 body with every problem', async () => {
    const body = await handler.handle(
      'set-properties',
      mqttRequest(json({ 'free-beds': 'one', colour: 'red' })),
    );

    expect(body).toEqual({
      message: [
        expect.stringMatching(/^property free-beds: /),
        'property colour is not declared',
      ],
      error: 'Bad Request',
      statusCode: 400,
    });
  });

  it.each([[[]], ['on'], [null]])(
    'Should refuse a body that is not an object, such as %j',
    async (value) => {
      const body = await handler.handle(
        'set-properties',
        mqttRequest(json(value)),
      );

      expect(body).toEqual({
        message: 'Validation Failed',
        error: 'Bad Request',
        statusCode: 400,
      });
    },
  );

  it.each(['properties', 'set-properties'] as const)(
    'Should answer %s without a state machine file as GET /fsm does',
    async (route) => {
      properties.load(undefined, STORE);

      expect(await handler.handle(route, mqttRequest(json({})))).toEqual(
        NO_MACHINE,
      );
    },
  );
});
