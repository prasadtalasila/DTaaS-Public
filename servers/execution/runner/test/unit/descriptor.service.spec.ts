import { afterEach, describe, expect, it, jest } from '@jest/globals';
import Config from 'src/config/configuration.service';
import DescriptorService from 'src/descriptor.service';
import { FsmStateDto } from 'src/dto/fsm.dto';
import FsmService from 'src/fsm/fsm.service';
import { CommandRecord } from 'src/interfaces/command.interface';
import Changes from 'src/notify/changes';
import Queue from 'src/queue.service';

const NOW = new Date('2026-10-25T10:00:00.000Z');

const machine: FsmStateDto = {
  state: 'execute',
  status: 'running',
  entry: 3,
  events: ['restart'],
};

const command = (finished: boolean, status = 'invalid'): CommandRecord => ({
  id: 2,
  name: 'execute',
  status,
  stdout: 'output',
  stderr: '',
  exitCode: null,
  finished,
  receivedAt: '2026-10-25T09:59:58.000Z',
  finishedAt: finished ? '2026-10-25T09:59:59.000Z' : null,
});

// A descriptor service over fakes of its configuration, state machine
// and queue
function createService(
  state: FsmStateDto | undefined,
  latest: CommandRecord | undefined,
  values?: Record<string, string | number | boolean>,
) {
  const config = {
    getId: () => 'hospital-1',
    getAttributes: () => ({ city: 'Aarhus' }),
    permitCommands: () => ['create', 'execute'],
  };
  const fsm = {
    check: () => state,
    managerCommands: () => ['execute'],
    parameters: () => values && { values: () => values },
    onEscalation: jest.fn(),
  };
  const queue = { activeCommand: () => latest };
  return new DescriptorService(
    config as unknown as Config,
    fsm as unknown as FsmService,
    queue as unknown as Queue,
  );
}

describe('Descriptor service', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('Should describe the digital twin', () => {
    expect(createService(machine, undefined).describe()).toEqual({
      id: 'hospital-1',
      attributes: { city: 'Aarhus' },
      commands: ['create', 'execute'],
      stateMachine: true,
      manager: { commands: ['execute'] },
    });
  });

  it('Should build a state document without a machine or a command', () => {
    jest.useFakeTimers({ now: NOW });

    expect(createService(undefined, undefined).state()).toEqual({
      id: 'hospital-1',
      time: '2026-10-25T10:00:00.000Z',
      machine: null,
      parameters: {},
      command: null,
    });
  });

  it('Should show the values of the declared parameters', () => {
    const values = { scope: 'multi', capacity: 20 };

    expect(createService(undefined, undefined, values).state()).toMatchObject({
      parameters: values,
    });
  });

  it('Should show an unfinished command as running', () => {
    expect(createService(machine, command(false)).state()).toMatchObject({
      machine,
      command: {
        name: 'execute',
        status: 'running',
        receivedAt: '2026-10-25T09:59:58.000Z',
        finishedAt: null,
      },
    });
  });

  it.each(['valid', 'failed', 'invalid', 'stopped'])(
    'Should show a finished command as %s',
    (status) => {
      expect(
        createService(machine, command(true, status)).state().command,
      ).toEqual({
        name: 'execute',
        status,
        receivedAt: '2026-10-25T09:59:58.000Z',
        finishedAt: '2026-10-25T09:59:59.000Z',
      });
    },
  );

  it('Should pass the changes of the machine and the queue to a listener', () => {
    const machineChanges = new Changes();
    const queueChanges = new Changes();
    const service = new DescriptorService(
      {} as Config,
      { onChange: (l: () => void) => machineChanges.on(l) } as FsmService,
      { onChange: (l: () => void) => queueChanges.on(l) } as Queue,
    );
    const listener = jest.fn();

    service.onChange(listener);
    machineChanges.emit();
    queueChanges.emit();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('Should pass an escalation listener to the state machine', () => {
    const onEscalation = jest.fn();
    const service = new DescriptorService(
      {} as Config,
      { onEscalation } as unknown as FsmService,
      {} as Queue,
    );
    const listener = jest.fn();

    service.onEscalation(listener);

    expect(onEscalation).toHaveBeenCalledWith(listener);
  });
});
