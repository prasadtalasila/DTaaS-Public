import { describe, expect, it } from '@jest/globals';
import {
  schemaProblems,
  validator,
  valueProblems,
  valueSchema,
  ValueSchema,
} from 'src/fsm/value-schema';

const UNITS = { units: true };

const problems = (schema: ValueSchema, rules = UNITS) =>
  schemaProblems('property p', schema, rules);

const fits = (schema: ValueSchema, value: unknown) =>
  valueProblems('property p', validator(schema), value);

const ward: ValueSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    free: { type: 'integer', minimum: 0, unit: 'beds' },
    history: { type: 'array', items: { type: 'number', unit: '%' } },
  },
  required: ['name'],
};

describe('Value schema', () => {
  it.each<ValueSchema>([
    { type: 'string' },
    { type: 'string', enum: ['open', 'full'] },
    { type: 'integer', enum: [1, 2], unit: 'beds' },
    { type: 'number', minimum: 0, maximum: 100, unit: '%' },
    { type: 'boolean' },
    ward,
  ])('Should accept the declaration %j', (schema) => {
    expect(valueSchema.parse(schema)).toEqual(schema);
    expect(problems(schema)).toEqual([]);
  });

  it.each([
    ['an unknown type', { type: 'date' }],
    ['an unknown keyword', { type: 'string', pattern: 'a+' }],
    ['an empty enum', { type: 'string', enum: [] }],
    ['an empty unit', { type: 'number', unit: '' }],
    ['a nested unknown keyword', { type: 'array', items: { type: 'x' } }],
    [
      'a nested name that is no name',
      { type: 'object', properties: { '-a': { type: 'string' } } },
    ],
  ])('Should refuse %s', (_, schema) => {
    expect(valueSchema.safeParse(schema).success).toBe(false);
  });

  it.each<[string, ValueSchema, string[]]>([
    [
      'a number without a unit',
      { type: 'number' },
      ['property p: type number needs unit'],
    ],
    [
      'an integer without a unit',
      { type: 'integer' },
      ['property p: type integer needs unit'],
    ],
    [
      'a unit on a string',
      { type: 'string', unit: 'm' },
      ['property p: unit does not apply to type string'],
    ],
    [
      'a bound on a string',
      { type: 'string', minimum: 1 },
      ['property p: minimum does not apply to type string'],
    ],
    [
      'an enum on a boolean',
      { type: 'boolean', enum: ['yes'] },
      ['property p: enum does not apply to type boolean'],
    ],
    [
      'an array without items',
      { type: 'array' },
      ['property p: type array needs items'],
    ],
    [
      'an object without properties',
      { type: 'object' },
      ['property p: type object needs properties'],
    ],
    [
      'an enum value of another type',
      { type: 'string', enum: ['a', 1] },
      ['property p: enum value 1 is no string'],
    ],
    [
      'an enum value that is no integer',
      { type: 'integer', enum: [1.5], unit: 'beds' },
      ['property p: enum value 1.5 is no integer'],
    ],
    [
      'a minimum above the maximum',
      { type: 'number', minimum: 2, maximum: 1, unit: 'm' },
      ['property p: minimum is above maximum'],
    ],
    [
      'a required name that is no property',
      { type: 'object', properties: {}, required: ['a'] },
      ['property p: required a is not one of the properties'],
    ],
  ])('Should name the problem of %s', (_, schema, expected) => {
    expect(problems(schema)).toEqual(expected);
  });

  it('Should name the problems of nested values after their place', () => {
    const schema: ValueSchema = {
      type: 'object',
      properties: {
        free: { type: 'integer' },
        history: { type: 'array', items: { type: 'number' } },
      },
    };

    expect(problems(schema)).toEqual([
      'property p.free: type integer needs unit',
      'property p.history items: type number needs unit',
    ]);
  });

  it('Should allow no unit when the rules ask for none', () => {
    const none = { units: false };

    expect(problems({ type: 'number' }, none)).toEqual([]);
    expect(problems({ type: 'number', unit: 'm' }, none)).toEqual([
      'property p: unit does not apply to type number',
    ]);
  });
});

describe('Values of a declaration', () => {
  it('Should check loosely a declaration that lacks what its type needs', () => {
    expect(fits({ type: 'array' }, [1, 'a'])).toEqual([]);
    expect(fits({ type: 'object' }, {})).toEqual([]);
    expect(fits({ type: 'object' }, { a: 1 })).toHaveLength(1);
  });

  it.each<[ValueSchema, unknown]>([
    [{ type: 'string' }, 'open'],
    [{ type: 'string', enum: ['open', 'full'] }, 'full'],
    [{ type: 'integer', unit: 'beds' }, 3],
    [{ type: 'integer', enum: [1, 2], unit: 'beds' }, 2],
    [{ type: 'number', minimum: 0, maximum: 100, unit: '%' }, 99.5],
    [{ type: 'boolean' }, false],
    [ward, { name: 'cardiology', free: 0, history: [10, 20.5] }],
    [ward, { name: 'cardiology' }],
  ])('Should accept for %j the value %j', (schema, value) => {
    expect(fits(schema, value)).toEqual([]);
  });

  it.each<[ValueSchema, unknown, RegExp]>([
    [{ type: 'string' }, 1, /^property p: .*expected string/],
    [
      { type: 'string', enum: ['open', 'full'] },
      'shut',
      /^property p: .*"open"\|"full"/,
    ],
    [{ type: 'integer', unit: 'beds' }, 1.5, /^property p: .*expected int/],
    [{ type: 'number', minimum: 0, unit: '%' }, -1, /^property p: Too small/],
    [{ type: 'number', maximum: 100, unit: '%' }, 101, /^property p: Too big/],
    [
      { type: 'number', unit: '%' },
      Number.NaN,
      /^property p: .*expected number/,
    ],
    [{ type: 'boolean' }, 'true', /^property p: .*expected boolean/],
    [ward, { free: 1 }, /^property p\.name: /],
    [ward, { name: 'a', free: -1 }, /^property p\.free: Too small/],
    [ward, { name: 'a', history: [1, 'x'] }, /^property p\.history\[1\]: /],
    [ward, { name: 'a', other: 1 }, /^property p: Unrecognized key/],
    [ward, [], /^property p: .*expected object/],
  ])('Should refuse for %j the value %j', (schema, value, message) => {
    const found = fits(schema, value);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(message);
  });
});
