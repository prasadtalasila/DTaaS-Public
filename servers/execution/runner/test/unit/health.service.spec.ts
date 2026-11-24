import { afterEach, describe, expect, it, jest } from '@jest/globals';
import Config from 'src/config/configuration.service';
import FsmService from 'src/fsm/fsm.service';
import HealthService from 'src/health.service';
import Queue from 'src/queue.service';
import type { ScriptUser } from 'src/scripts/separation';
import Pause from 'src/snapshot/pause';

function createService(
  mode: 'file' | 'memory',
  user?: ScriptUser,
  pause = new Pause(),
) {
  const queue = { mode: jest.fn(() => mode) };
  const config = { getScriptUser: () => user };
  return new HealthService(
    queue as unknown as Queue,
    config as unknown as Config,
    { pause } as unknown as FsmService,
  );
}

describe('Health service', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['connected', 'ok'],
    ['disabled', 'ok'],
    ['disconnected', 'degraded'],
  ] as const)('Should report MQTT %s as %s', (mqtt, status) => {
    expect(createService('memory').check(mqtt)).toMatchObject({
      status,
      mqtt,
    });
  });

  it.each(['file', 'memory'] as const)(
    'Should report a %s database',
    (database) => {
      expect(createService(database).check('disabled')).toMatchObject({
        database,
      });
    },
  );

  it('Should report no script account without scripts.user', () => {
    expect(createService('memory').check('disabled').scripts).toBeNull();
  });

  it('Should report the name of the script account', () => {
    const account = {
      name: 'dt-script',
      uid: 999,
      gid: 986,
      home: '/',
      groups: [986],
    };
    const user = { account, runDirectory: '/var/lib/dt/run' };

    expect(createService('file', user).check('connected').scripts).toEqual({
      user: 'dt-script',
    });
  });

  it('Should report whether a save runs', () => {
    const pause = new Pause();
    const service = createService('file', undefined, pause);

    expect(service.check('disabled').saving).toBe(false);
    pause.begin();
    expect(service.check('disabled').saving).toBe(true);
    pause.end();
    expect(service.check('disabled').saving).toBe(false);
  });

  it('Should report the uptime in whole seconds', () => {
    jest.spyOn(process, 'uptime').mockReturnValue(3724.6);
    expect(createService('memory').check('disabled').uptime).toBe(3724);
  });
});
