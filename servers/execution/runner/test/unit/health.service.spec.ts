import { afterEach, describe, expect, it, jest } from '@jest/globals';
import HealthService from 'src/health.service';
import Queue from 'src/queue.service';

function createService(mode: 'file' | 'memory') {
  const queue = { mode: jest.fn(() => mode) };
  return new HealthService(queue as unknown as Queue);
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

  it('Should report the uptime in whole seconds', () => {
    jest.spyOn(process, 'uptime').mockReturnValue(3724.6);
    expect(createService('memory').check('disabled').uptime).toBe(3724);
  });
});
