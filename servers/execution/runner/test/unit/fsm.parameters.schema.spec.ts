import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { parseDefinition } from 'src/fsm/definition';
import Parameters, { oldEnums } from 'src/fsm/parameters';

const parse = (section: string) =>
  parseDefinition(`parameters:\n${section}\nstates: {create: {}}`, 'dt.yaml', {
    commands: ['create'],
    peers: [],
  }).parameters;

const OLD = '  scope: {type: enum, values: [single, multi], default: single}';

const NEW = '  scope: {type: string, enum: [single, multi], default: single}';

describe('Parameter types', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Should read an enum of before 0.11 as a string with an enum', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    expect(parse(OLD)).toEqual(parse(NEW));
    expect(parse(OLD).get('scope')).toEqual({
      type: 'string',
      enum: ['single', 'multi'],
      default: 'single',
      controllable: false,
    });
  });

  it('Should warn of the parameters that spell an enum the old way', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    parse(NEW);

    expect(warn).not.toHaveBeenCalled();

    parse(`${OLD}\n  size: {type: number, default: 1}`);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(
      /dt.yaml: parameters scope use type enum/,
    );
  });

  it.each([
    [undefined],
    [null],
    ['text'],
    [{ a: null, b: { type: 'string' } }],
  ])('Should find no old enum in %j', (section) => {
    expect(oldEnums(section)).toEqual([]);
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
