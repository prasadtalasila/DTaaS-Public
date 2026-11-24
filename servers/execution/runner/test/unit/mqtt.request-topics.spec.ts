import { describe, expect, it } from '@jest/globals';
import { mqttRoutes } from 'src/mqtt/mqtt.config';
import RequestTopics from 'src/mqtt/request-topics';

const BASE = 'dtaas/runner';

describe('MQTT request topics', () => {
  it('Should have no topics without a base topic', () => {
    const topics = new RequestTopics();

    expect(topics.keys()).toEqual([]);
    expect(topics.get('dtaas/runner/dt')).toBeUndefined();
  });

  it('Should have a topic for each route', () => {
    const topics = new RequestTopics(BASE);

    expect(topics.keys()).toHaveLength(mqttRoutes.length);
    expect(topics.get(`${BASE}/dt`)).toBe('dt');
    expect(topics.get(`${BASE}/properties`)).toBe('properties');
    expect(topics.has(`${BASE}/dt/response`)).toBe(false);
  });

  it.each([
    ['parameters/set', 'set-parameters'],
    ['peers/set', 'set-peers'],
    ['properties/set', 'set-properties'],
  ])('Should write on %s', (level, route) => {
    expect(new RequestTopics(BASE).get(`${BASE}/${level}`)).toBe(route);
  });

  it.each(['set-parameters', 'set-peers', 'set-properties'])(
    'Should have no topic %s, which 0.12 removed or never had',
    (level) => {
      const topics = new RequestTopics(BASE);

      expect(topics.has(`${BASE}/${level}`)).toBe(false);
      expect(topics.get(`${BASE}/${level}`)).toBeUndefined();
    },
  );
});
