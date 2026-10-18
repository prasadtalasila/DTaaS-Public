import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createService, scriptFolder } from './fsm.fixture';

describe('State machine service requests', () => {
  let dir: string;

  beforeAll(() => {
    dir = scriptFolder();
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const setup = (location = dir) => createService(location);

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
