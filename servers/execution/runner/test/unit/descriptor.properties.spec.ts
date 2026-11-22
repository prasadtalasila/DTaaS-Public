import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import Config from 'src/config/configuration.service';
import DescriptorService from 'src/descriptor.service';
import { PropertyRow } from 'src/fsm/properties';
import FsmService from 'src/fsm/fsm.service';
import Queue from 'src/queue.service';
import { ValueSchema } from 'src/fsm/value-schema';

const T1 = '2026-11-22T10:00:00.000Z';

const DECLARED = new Map<string, ValueSchema>([
  ['free-beds', { type: 'integer', unit: 'beds' }],
]);

// A descriptor service over the declared properties and the stored rows
function setup(
  declared: typeof DECLARED | undefined,
  rows: PropertyRow[] = [],
) {
  const fsm = {
    check: () => undefined,
    declared: () => declared && { properties: declared },
    parameters: () => undefined,
    onChange: jest.fn(),
    onAnswer: jest.fn(),
    onEscalation: jest.fn(),
  };
  const queue = {
    activeCommand: () => undefined,
    peerSwitches: () => new Map(),
    onChange: jest.fn(),
    storedProperties: () => rows,
    saveProperties: jest.fn(),
  };
  const config = {
    getId: () => 'hospital-1',
    getPeers: () => [],
    getStateInterval: () => 250,
  };
  const service = new DescriptorService(
    config as unknown as Config,
    fsm as unknown as FsmService,
    queue as unknown as Queue,
  );
  service.onModuleInit();
  return { service, queue };
}

describe('Descriptor service properties', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Should restore the stored values into the state document', () => {
    const { service } = setup(DECLARED, [
      { name: 'free-beds', value: 2, time: T1, by: 'script' },
    ]);

    expect(service.state().properties).toEqual({
      'free-beds': { value: 2, time: T1 },
    });
  });

  it('Should warn of the stored values that it dropped', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { service } = setup(DECLARED, [
      { name: 'free-beds', value: 'two', time: T1, by: 'script' },
    ]);

    expect(service.state().properties['free-beds'].value).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(
      /Dropped the stored properties free-beds/,
    );
  });

  it('Should have no properties without a state machine file', () => {
    const { service } = setup(undefined);

    expect(service.state().properties).toEqual({});
    expect(service.properties().document()).toBeUndefined();
  });

  it('Should store a write and signal the change of the state document', () => {
    const { service, queue } = setup(DECLARED);
    const changed = jest.fn();
    service.onChange(changed);

    expect(service.properties().set({ 'free-beds': 1 }, 'script')).toEqual([]);
    expect(queue.saveProperties).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('Should give the interval of the configuration', () => {
    expect(setup(DECLARED).service.stateInterval()).toBe(250);
  });
});
