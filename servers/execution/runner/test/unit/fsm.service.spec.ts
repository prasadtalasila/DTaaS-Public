import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import Config from 'src/config/configuration.service';
import ExecaManager from 'src/execa-manager.service';
import { DEFINITION_FILE } from 'src/fsm/definition';
import FsmService from 'src/fsm/fsm.service';

const DEFINITION = `
events: [stop, reset]
states:
  create: {on: {$success: execute, $failure: terminate}}
  execute: {on: {stop: terminate}}
  terminate: {on: {reset: create}}`;

const settle = () => new Promise(setImmediate);

// Runs each script until the test finishes it
function fakeManager() {
  const finishers = new Map<string, (success: boolean) => void>();
  const manager = {
    isRunning: jest.fn((name: string) => finishers.has(name)),
    newCommand: jest.fn(
      (name: string) =>
        new Promise<[boolean, Map<string, string>]>((resolve) => {
          finishers.set(name, (success) => {
            finishers.delete(name);
            resolve([success, new Map()]);
          });
        }),
    ),
  };
  const finish = async (name: string, success: boolean) => {
    finishers.get(name)?.(success);
    await settle();
  };
  return { manager, finish };
}

describe('State machine service', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fsm-'));
    writeFileSync(join(dir, DEFINITION_FILE), DEFINITION);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function setup(location = dir) {
    const { manager, finish } = fakeManager();
    const config = {
      getLocation: () => location,
      permitCommands: () => ['create', 'execute', 'terminate'],
    } as unknown as Config;
    const service = new FsmService(manager as unknown as ExecaManager, config);
    service.load();
    return { service, manager, finish };
  }

  it('Should answer that there is no state machine without the file', () => {
    const { service } = setup(join(dir, 'missing'));

    expect(service.transition('create')).toEqual({
      status: 'no state machine',
      state: null,
    });
    expect(service.event('stop')).toEqual({
      status: 'no state machine',
      state: null,
    });
    expect(service.check()).toBeUndefined();
  });

  it('Should report a machine that has not started', () => {
    const { service } = setup();

    expect(service.check()).toEqual({
      state: null,
      status: 'none',
      events: ['reset', 'stop'],
    });
  });

  it('Should enter the requested state and run its script', () => {
    const { service, manager } = setup();

    expect(service.transition('create')).toEqual({
      status: 'accepted',
      state: 'create',
    });
    expect(manager.newCommand).toHaveBeenCalledWith('create');
    expect(service.check()?.status).toBe('running');
  });

  it('Should refuse an undeclared state', () => {
    const { service, manager } = setup();

    expect(service.transition('configure').status).toBe('invalid state');
    expect(manager.newCommand).not.toHaveBeenCalled();
  });

  it('Should refuse a transition request while the script runs', () => {
    const { service } = setup();
    service.transition('execute');

    expect(service.transition('create')).toEqual({
      status: 'busy',
      state: 'execute',
    });
  });

  it('Should accept a transition request once the script finished', async () => {
    const { service, finish } = setup();
    service.transition('execute');
    await finish('execute', true);

    expect(service.check()?.status).toBe('valid');
    expect(service.transition('create').status).toBe('accepted');
  });

  it('Should move on when the script succeeds', async () => {
    const { service, manager, finish } = setup();
    service.transition('create');
    await finish('create', true);

    expect(manager.newCommand).toHaveBeenLastCalledWith('execute');
    expect(service.check()).toMatchObject({
      state: 'execute',
      status: 'running',
    });
  });

  it('Should move on when the script fails', async () => {
    const { service, manager, finish } = setup();
    service.transition('create');
    await finish('create', false);

    expect(manager.newCommand).toHaveBeenLastCalledWith('terminate');
  });

  it('Should stay in a state without a completion transition', async () => {
    const { service, finish } = setup();
    service.transition('terminate');
    await finish('terminate', false);

    expect(service.check()).toMatchObject({
      state: 'terminate',
      status: 'invalid',
    });
  });

  it('Should follow an event while the script runs', () => {
    const { service, manager } = setup();
    service.transition('execute');

    expect(service.event('stop')).toEqual({
      status: 'accepted',
      state: 'terminate',
    });
    expect(manager.newCommand).toHaveBeenLastCalledWith('terminate');
  });

  it('Should ignore the completion of a state it left', async () => {
    const { service, manager, finish } = setup();
    service.transition('execute');
    service.event('stop');
    await finish('execute', true);

    expect(manager.newCommand).toHaveBeenCalledTimes(2);
    expect(service.check()).toMatchObject({
      state: 'terminate',
      status: 'running',
    });
  });

  it('Should refuse an undeclared event', () => {
    const { service } = setup();

    expect(service.event('$success').status).toBe('invalid event');
    expect(service.event('start').status).toBe('invalid event');
  });

  it('Should refuse an event without a transition', () => {
    const { service } = setup();

    expect(service.event('stop')).toEqual({
      status: 'no transition',
      state: null,
    });
    service.transition('create');
    expect(service.event('stop').status).toBe('no transition');
  });

  it('Should not enter a state whose script is still running', async () => {
    const { service, manager, finish } = setup();
    service.transition('execute');
    service.event('stop');
    await finish('terminate', true);

    expect(service.event('reset').status).toBe('accepted');
    await finish('create', true);

    expect(manager.newCommand).toHaveBeenCalledTimes(3);
    expect(service.check()).toMatchObject({
      state: 'create',
      status: 'valid',
    });
    expect(service.transition('execute')).toEqual({
      status: 'script running',
      state: 'create',
    });
  });

  it('Should treat a script that could not start as failed', async () => {
    const { service, manager } = setup();
    manager.newCommand.mockRejectedValueOnce(new Error('database closed'));
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

    service.transition('create');
    await settle();

    expect(manager.newCommand).toHaveBeenLastCalledWith('terminate');
  });

  it('Should stop accepting requests on shutdown', async () => {
    const { service, manager, finish } = setup();
    service.transition('create');

    await service.beforeApplicationShutdown();
    await finish('create', true);

    expect(manager.newCommand).toHaveBeenCalledTimes(1);
    expect(service.event('stop').status).toBe('stopping');
    expect(service.transition('create').status).toBe('stopping');
  });

  describe('repeated requests', () => {
    it('Should give a repeated request the first reply', () => {
      const { service, manager } = setup();

      const first = service.transition('execute', 'key-1');
      const repeat = service.transition('execute', 'key-1');

      expect(repeat).toEqual(first);
      expect(repeat.status).toBe('accepted');
      expect(manager.newCommand).toHaveBeenCalledTimes(1);
    });

    it('Should refuse a request key of another request', () => {
      const { service } = setup();
      service.transition('execute', 'key-1');

      expect(service.event('stop', 'key-1')).toEqual({
        status: 'invalid request key',
        state: 'execute',
      });
    });

    it('Should treat an empty request key as no key', () => {
      const { service } = setup();
      service.transition('execute', '');

      expect(service.transition('execute', '').status).toBe('busy');
    });
  });
});
