import { readFileSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { configSchema } from 'src/config/config.schema';

const valid = {
  id: 'hospital-1',
  port: 5000,
  location: 'scripts',
  commands: ['create', 'execute'],
};

// The message that names every problem of an invalid configuration
function problems(config: unknown): string {
  const result = configSchema.safeParse(config);
  return result.success ? '' : z.prettifyError(result.error);
}

describe('Runner configuration schema', () => {
  it.each(['runner.yaml.sample', 'runner.test.yaml.sample'])(
    'Should accept the sample configuration %s',
    (file) => {
      const sample = yaml.load(readFileSync(`config/${file}`, 'utf8'));

      expect(configSchema.safeParse(sample).success).toBe(true);
    },
  );

  it('Should default the attributes to an empty map', () => {
    expect(configSchema.parse(valid)).toEqual({ ...valid, attributes: {} });
  });

  it('Should accept every key of the configuration', () => {
    const config = {
      ...valid,
      attributes: { city: 'Aarhus', beds: 120, open: true },
      stateMachine: 'scripts/state-machine.yaml',
      database: 'runner.db',
      mqtt: { url: 'mqtt://localhost:1883', topic: 'dtaas/runner' },
    };

    expect(configSchema.parse(config)).toEqual({
      ...config,
      mqtt: { ...config.mqtt, protocolVersion: 5 },
    });
  });

  it.each([
    [
      'a missing id',
      { ...valid, id: undefined },
      /expected string[\s\S]*at id/,
    ],
    [
      'an invalid id',
      { ...valid, id: '../hospital' },
      /64 letters[\s\S]*at id/,
    ],
    [
      'a missing commands list',
      { ...valid, commands: undefined },
      /expected array[\s\S]*at commands/,
    ],
    [
      'a nested attribute',
      { ...valid, attributes: { ward: { beds: 12 } } },
      /at attributes.ward/,
    ],
    [
      'an attribute with an invalid name',
      { ...valid, attributes: { 'a b': 1 } },
      /Invalid key[\s\S]*at attributes/,
    ],
    [
      'an unknown key',
      { ...valid, script: 'create' },
      /Unrecognized key[\s\S]*script/,
    ],
    [
      'an empty state machine path',
      { ...valid, stateMachine: '' },
      /at stateMachine/,
    ],
    [
      'an invalid mqtt section',
      { ...valid, mqtt: { url: 'mqtt://localhost:1883', topic: 'dtaas/#' } },
      /wildcards[\s\S]*at mqtt.topic/,
    ],
  ])('Should reject %s', (_, config, message) => {
    expect(problems(config)).toMatch(message);
  });

  it('Should name every problem', () => {
    const message = problems({ ...valid, id: undefined, port: 'any' });

    expect(message).toMatch(/at id/);
    expect(message).toMatch(/at port/);
  });
});
