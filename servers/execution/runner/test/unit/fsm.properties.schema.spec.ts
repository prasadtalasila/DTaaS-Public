import { describe, expect, it } from '@jest/globals';
import { parseDefinition } from 'src/fsm/definition';

const EXAMPLE = `
properties:
  free-beds: {type: integer, minimum: 0, unit: beds}
  ward-status: {type: string, enum: [open, full, closed]}
  forecast:
    type: array
    items: {type: number, unit: beds}
`;

const parse = (text: string) =>
  parseDefinition(text, 'dt.yaml', { commands: ['create'], peers: [] });

describe('Property declarations', () => {
  it('Should read the declarations of the example', () => {
    const { properties } = parse(EXAMPLE);

    expect([...properties.keys()]).toEqual([
      'free-beds',
      'ward-status',
      'forecast',
    ]);
    expect(properties.get('free-beds')).toEqual({
      type: 'integer',
      minimum: 0,
      unit: 'beds',
    });
  });

  it('Should have no properties without the section', () => {
    expect(parse('states: {create: {}}').properties).toEqual(new Map());
  });

  it.each([
    [
      'a number without a unit',
      '  a: {type: number}',
      'property a: type number needs unit',
    ],
    [
      'a nested number without a unit',
      '  a: {type: array, items: {type: integer}}',
      'property a items: type integer needs unit',
    ],
    ['a default', '  a: {type: string, default: x}', 'default'],
    ['a source', '  a: {type: string, source: sensed}', 'source'],
    ['an unknown type', '  a: {type: date}', 'properties.a.type'],
    [
      'a reserved name',
      '  set: {type: string}',
      'set and response are reserved',
    ],
    [
      'a name that is not a name',
      '  -a: {type: string}',
      'Invalid key in record',
    ],
    [
      'a __proto__ name',
      '  __proto__: {type: string}',
      '__proto__ is not a valid name',
    ],
    [
      'a nested __proto__ name',
      '  a: {type: object, properties: {__proto__: {type: string}}}',
      '__proto__ is not a valid name',
    ],
  ])('Should reject %s', (_, section, message) => {
    expect(() => parse(`properties:\n${section}`)).toThrow(message);
  });

  it('Should reject a name that is a parameter too', () => {
    const text =
      'parameters:\n  beds: {type: integer, default: 2}\n' +
      'properties:\n  beds: {type: integer, unit: beds}';

    expect(() => parse(text)).toThrow(
      'beds is both a parameter and a property',
    );
  });
});
