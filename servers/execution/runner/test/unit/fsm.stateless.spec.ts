import { describe, expect, it } from '@jest/globals';
import { parseDefinition } from 'src/fsm/definition';
import { machineOf } from 'src/fsm/state-machine';

const known = { commands: ['create'], peers: ['hospital-2'] };

const parse = (text: string) => parseDefinition(text, 'dt.yaml', known);

const DECLARATIONS = `
parameters:
  capacity: {type: integer, default: 2}
properties:
  free-beds: {type: integer, unit: beds}
manager:
  commands: [create]
`;

describe('State machine file without states', () => {
  it('Should read the declarations of a file without states', () => {
    const definition = parse(DECLARATIONS);

    expect(definition.states.size).toBe(0);
    expect([...definition.parameters.keys()]).toEqual(['capacity']);
    expect([...definition.properties.keys()]).toEqual(['free-beds']);
    expect(definition.managerCommands).toEqual(['create']);
  });

  it('Should take states: {} for a file without states', () => {
    expect(parse('states: {}').states.size).toBe(0);
  });

  it.each([
    ['events', 'events: [start]', 'events need states'],
    [
      'subscriptions',
      'subscriptions:\n  - {peer: hospital-2, when: {online: false}, event: e}',
      'subscriptions need states',
    ],
    [
      'a parameter that raises an event',
      'parameters:\n  a: {type: string, default: x, event: go}',
      'parameter a raises undeclared event go',
    ],
  ])('Should refuse %s without states', (_, text, message) => {
    expect(() => parse(text)).toThrow(message);
  });

  it('Should refuse an empty file', () => {
    expect(() => parse('# nothing here\n')).toThrow('Invalid state machine');
  });

  it('Should have no machine without a file or without states', () => {
    expect(machineOf(undefined)).toBeUndefined();
    expect(machineOf(parse(DECLARATIONS))).toBeUndefined();
  });

  it('Should have a machine with states, at the stored state and entry', () => {
    const machine = machineOf(parse('states: {create: {}}'), 'create', 3);

    expect(machine?.describe('none')).toEqual({
      state: 'create',
      status: 'none',
      entry: 3,
      events: [],
    });
  });
});
