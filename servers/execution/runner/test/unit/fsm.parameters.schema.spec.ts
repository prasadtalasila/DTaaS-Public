import { describe, expect, it } from '@jest/globals';
import { parseDefinition } from 'src/fsm/definition';
import Parameters from 'src/fsm/parameters';

const parse = (section: string) =>
  parseDefinition(`parameters:\n${section}\nstates: {create: {}}`, 'dt.yaml', {
    commands: ['create'],
    peers: [],
  }).parameters;

const OLD = '  scope: {type: enum, values: [single, multi], default: single}';

const NEW = '  scope: {type: string, enum: [single, multi], default: single}';

describe('Parameter types', () => {
  it('Should read a string with an enum', () => {
    expect(parse(NEW).get('scope')).toEqual({
      type: 'string',
      enum: ['single', 'multi'],
      default: 'single',
      controllable: false,
    });
  });

  it('Should refuse type enum with values, which 0.12 removed', () => {
    expect(() => parse(OLD)).toThrow(
      'Invalid state machine in dt.yaml:\n' +
        '✖ Unrecognized key: "values"\n' +
        '  → at parameters.scope\n' +
        '✖ Invalid option: expected one of "string"|"number"|"integer"|"boolean"\n' +
        '  → at parameters.scope.type\n' +
        '✖ parameter scope: write type string with enum, as 0.12.0 removed type enum',
    );
  });

  it('Should take an integer within its bounds and an enum of numbers', () => {
    const declared = parse(
      '  beds: {type: integer, minimum: 1, maximum: 9, default: 2, controllable: true}\n' +
        '  level: {type: number, enum: [0.5, 1], default: 1, controllable: true}',
    );
    const parameters = new Parameters(declared);

    expect(parameters.check({ beds: 9, level: 0.5 })).toMatchObject({
      events: [],
    });
    expect(parameters.check({ beds: 2.5, level: 2 })).toEqual({
      problems: [
        expect.stringMatching(/^parameter beds: .*expected int/),
        expect.stringMatching(/^parameter level: /),
      ],
    });
    expect(parameters.check({ beds: 10 })).toEqual({
      problems: [expect.stringMatching(/^parameter beds: Too big/)],
    });
    expect(parameters.document().beds).toEqual({
      value: 2,
      type: 'integer',
      minimum: 1,
      maximum: 9,
      default: 2,
      controllable: true,
    });
  });

  it.each([
    [
      'a default outside the bounds',
      '  a: {type: integer, minimum: 1, default: 0}',
      'parameter a default: Too small',
    ],
    [
      'an enum on a boolean',
      '  a: {type: boolean, enum: [x], default: true}',
      'parameter a: enum does not apply to type boolean',
    ],
    [
      'an enum value of another type',
      '  a: {type: string, enum: [x, 1], default: x}',
      'parameter a: enum value 1 is no string',
    ],
    [
      'a bound on a string',
      '  a: {type: string, maximum: 3, default: x}',
      'parameter a: maximum does not apply to type string',
    ],
    [
      'a unit, as a parameter is no measurement',
      '  a: {type: number, unit: m, default: 1}',
      'unit',
    ],
    ['an object', '  a: {type: object, default: x}', 'parameters.a.type'],
    [
      'a reserved name',
      '  response: {type: string, default: x}',
      'set and response are reserved',
    ],
  ])('Should reject %s', (_, section, message) => {
    expect(() => parse(section)).toThrow(message);
  });
});
