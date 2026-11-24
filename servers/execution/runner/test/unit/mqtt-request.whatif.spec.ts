import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import DescriptorService from 'src/descriptor.service';
import ExecaManager from 'src/execa-manager.service';
import FsmService from 'src/fsm/fsm.service';
import MqttRequestHandler from 'src/mqtt/mqtt-request.handler';
import Pause, { saving } from 'src/snapshot/pause';
import { fakeManager, mqttRequest } from './mqtt.fixture';

const ASKED = { id: 57, name: 'forecast-beds', status: 'running' };

const RUN = { ...ASKED, status: 'valid', mode: 'what-if', result: 1 };

function createHandler() {
  const pause = new Pause();
  const whatIfs = {
    ask: jest.fn((_body: object) => Promise.resolve(ASKED)),
    result: jest.fn((_id: number) => RUN),
  };
  const declared = () => ({
    managerCommands: ['admit', 'forecast-beds'],
    whatIf: { commands: ['forecast-beds', 'forecast-staff'] },
  });
  const handler = new MqttRequestHandler(
    fakeManager('success') as unknown as ExecaManager,
    { pause, declared } as unknown as FsmService,
    { whatIfs: () => whatIfs } as unknown as DescriptorService,
  );
  return { handler, pause, whatIfs };
}

const json = (body: unknown) => Buffer.from(JSON.stringify(body));

const asManager = (body: unknown) => ({
  ...mqttRequest(json(body)),
  principal: { name: 'manager-1', role: 'manager' as const },
});

describe('MQTT what-if requests', () => {
  it('Should ask for a what-if with the payload of the POST body', async () => {
    const { handler, whatIfs } = createHandler();
    const body = { name: 'forecast-beds', input: { horizon: 'PT2H' } };

    expect(await handler.handle('whatif', mqttRequest(json(body)))).toEqual(
      ASKED,
    );
    expect(whatIfs.ask).toHaveBeenCalledWith(body);
  });

  it('Should read the result of a run', async () => {
    const { handler, whatIfs } = createHandler();

    expect(
      await handler.handle('whatif-result', mqttRequest(json({ id: 57 }))),
    ).toEqual(RUN);
    expect(whatIfs.result).toHaveBeenCalledWith(57);
  });

  it('Should answer an id that is no what-if as HTTP does', async () => {
    const { handler, whatIfs } = createHandler();
    whatIfs.result.mockImplementationOnce(() => {
      throw new NotFoundException();
    });

    expect(
      await handler.handle('whatif-result', mqttRequest(json({ id: 5 }))),
    ).toMatchObject({ statusCode: 404 });
  });

  it('Should refuse a payload without an id', async () => {
    const { handler, whatIfs } = createHandler();

    expect(
      await handler.handle('whatif-result', mqttRequest(json({ id: 'x' }))),
    ).toMatchObject({ statusCode: 400 });
    expect(whatIfs.result).not.toHaveBeenCalled();
  });

  it('Should let a manager ask only for a command that both lists hold', async () => {
    const { handler, whatIfs } = createHandler();

    const allowed = await handler.handle(
      'whatif',
      asManager({ name: 'forecast-beds' }),
    );
    const refused = await handler.handle(
      'whatif',
      asManager({ name: 'forecast-staff' }),
    );

    expect(allowed).toEqual(ASKED);
    expect(refused).toMatchObject({
      statusCode: 403,
      message: 'manager may not call whatif',
    });
    expect(whatIfs.ask).toHaveBeenCalledTimes(1);
  });

  it('Should answer a what-if refused by a save with saving', async () => {
    const { handler, whatIfs } = createHandler();
    whatIfs.ask.mockRejectedValueOnce(saving());

    expect(
      await handler.handle(
        'whatif',
        mqttRequest(json({ name: 'forecast-beds' })),
      ),
    ).toEqual({ status: 'saving' });
  });
});
