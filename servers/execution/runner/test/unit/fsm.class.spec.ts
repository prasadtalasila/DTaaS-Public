import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { InstanceValues } from 'src/fsm/class';
import { parseDefinition } from 'src/fsm/definition';
import { loadDefinition } from 'src/fsm/load';
import Parameters from 'src/fsm/parameters';

const CLASS = `
class:
  id: 'urn:dtaas:hospital'
  version: '1.0.0'
parameters:
  capacity: {type: integer, minimum: 1, default: 2}
  scope: {type: string, enum: [single, multi], default: single, controllable: true}
states: {create: {}}
`;

const known = { commands: ['create'], peers: [] };

const parse = (text: string) => parseDefinition(text, 'dt.yaml', known);

describe('Class of a state machine file', () => {
  it('Should read the id and the version of the class', () => {
    expect(parse(CLASS).dtClass).toEqual({
      id: 'urn:dtaas:hospital',
      version: '1.0.0',
    });
  });

  it('Should name no class without the section', () => {
    expect(parse('states: {create: {}}').dtClass).toBeUndefined();
  });

  it('Should read the class of a file without states', () => {
    expect(parse('class: {id: hospital, version: v2}').dtClass).toEqual({
      id: 'hospital',
      version: 'v2',
    });
  });

  it.each([
    ['no id', '{version: 1.0.0}', 'class.id'],
    ['no version', '{id: hospital}', 'class.version'],
    [
      'a version that is a number',
      '{id: hospital, version: 1.0}',
      'class.version',
    ],
    [
      'an id with a space',
      "{id: 'my hospital', version: v1}",
      'without spaces',
    ],
    ['an empty id', "{id: '', version: v1}", 'class.id'],
    [
      'an id that is too long',
      `{id: ${'a'.repeat(201)}, version: v1}`,
      'class.id',
    ],
    ['an unknown key', '{id: hospital, version: v1, extends: ward}', 'extends'],
  ])('Should refuse a class with %s', (_, section, message) => {
    expect(() => parse(`class: ${section}\nstates: {create: {}}`)).toThrow(
      message,
    );
  });
});

describe('Instance of a class', () => {
  let dir: string;
  let file: string;

  const load = (parameters?: InstanceValues) =>
    loadDefinition(file, { ...known, parameters });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-class-'));
    file = join(dir, 'dt.yaml');
    writeFileSync(file, CLASS);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('Should keep the defaults of the class without instance values', () => {
    expect(load()?.parameters.get('capacity')?.default).toBe(2);
    expect(load({})?.parameters.get('capacity')?.default).toBe(2);
  });

  it('Should take an instance value as the default of its parameter', () => {
    const definition = load({ capacity: 1, scope: 'multi' });
    const parameters = new Parameters(definition!.parameters);

    expect(parameters.values()).toEqual({ capacity: 1, scope: 'multi' });
    expect(parameters.document().capacity).toEqual({
      value: 1,
      type: 'integer',
      minimum: 1,
      default: 1,
      controllable: false,
    });
    expect(definition?.dtClass?.id).toBe('urn:dtaas:hospital');
  });

  it('Should let a stored value of a controllable parameter win', () => {
    const parameters = new Parameters(load({ scope: 'multi' })!.parameters);

    expect(parameters.restore({ scope: 'single' })).toEqual([]);
    expect(parameters.values().scope).toBe('single');
  });

  it('Should name every instance value that is undeclared or does not fit', () => {
    const values = { capacity: 0, scope: 'all', beds: 3 };

    expect(() => load(values)).toThrow(
      /Invalid parameters in runner.yaml for .*dt.yaml:\n✖ parameter capacity: Too small.*\n✖ parameter scope: .*\n✖ parameter beds is not declared/,
    );
  });

  it('Should refuse a value of the wrong type', () => {
    expect(() => load({ capacity: '2' })).toThrow(
      /parameter capacity: .*expected number/,
    );
  });

  it('Should refuse instance values without a state machine file', () => {
    expect(() =>
      loadDefinition(undefined, { ...known, parameters: { capacity: 1 } }),
    ).toThrow('The parameters of runner.yaml need a stateMachine file');
    expect(
      loadDefinition(undefined, { ...known, parameters: {} }),
    ).toBeUndefined();
    expect(loadDefinition(undefined, known)).toBeUndefined();
  });
});
