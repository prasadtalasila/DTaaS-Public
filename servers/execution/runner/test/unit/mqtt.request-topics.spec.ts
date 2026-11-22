import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { mqttRoutes } from 'src/mqtt/mqtt.config';
import RequestTopics from 'src/mqtt/request-topics';

const BASE = 'dtaas/runner';

describe('MQTT request topics', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Should have no topics without a base topic', () => {
    const topics = new RequestTopics();

    expect(topics.keys()).toEqual([]);
    expect(topics.get('dtaas/runner/dt')).toBeUndefined();
  });

  it('Should have a topic for each route, and the old write topics', () => {
    const topics = new RequestTopics(BASE);

    expect(topics.keys()).toHaveLength(mqttRoutes.length + 2);
    expect(topics.get(`${BASE}/dt`)).toBe('dt');
    expect(topics.get(`${BASE}/properties`)).toBe('properties');
    expect(topics.has(`${BASE}/dt/response`)).toBe(false);
  });

  it.each([
    ['parameters/set', 'set-parameters'],
    ['peers/set', 'set-peers'],
    ['properties/set', 'set-properties'],
  ])('Should write on %s without a warning', (level, route) => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const topics = new RequestTopics(BASE);

    expect(topics.get(`${BASE}/${level}`)).toBe(route);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['set-parameters', 'set-peers'])(
    'Should answer the old topic %s, with one warning',
    (route) => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      const topics = new RequestTopics(BASE);
      const routes = [1, 2].map(() => topics.get(`${BASE}/${route}`));

      expect(routes).toEqual([route, route]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(
        new RegExp(`${BASE}/${route} moved to ${BASE}/\\w+/set`),
      );
    },
  );

  it('Should have no old topic for the properties, which are new', () => {
    expect(new RequestTopics(BASE).has(`${BASE}/set-properties`)).toBe(false);
  });

  it('Should not warn when it is only asked whether a topic is one', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    expect(new RequestTopics(BASE).has(`${BASE}/set-peers`)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
