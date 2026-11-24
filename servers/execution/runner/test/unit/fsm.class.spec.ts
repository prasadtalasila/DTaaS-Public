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

describe('Snapshot scripts of a class', () => {
  const scripts = {
    commands: ['create', 'save-ward', 'restore-ward'],
    peers: [],
  };

  it('Should read the save and the restore script', () => {
    const text = 'snapshot: {save: save-ward, restore: restore-ward}\n';

    expect(parseDefinition(text, 'dt.yaml', scripts).snapshot).toEqual({
      save: 'save-ward',
      restore: 'restore-ward',
    });
  });

  it('Should name no scripts without the section', () => {
    expect(parse('states: {create: {}}').snapshot).toEqual({});
  });

  it('Should refuse a snapshot script that is no command of runner.yaml', () => {
    expect(() =>
      parse('snapshot: {save: save-ward, restore: create}\n'),
    ).toThrow(
      /dt\.yaml[\s\S]*snapshot save script save-ward is not a permitted command/,
    );
  });

  it('Should refuse an unknown key of the section', () => {
    expect(() => parse('snapshot: {save: create, every: 60}\n')).toThrow(
      /Invalid state machine in dt\.yaml/,
    );
  });
});

describe('What-if commands of a class', () => {
  const scripts = {
    commands: ['create', 'save-ward', 'forecast'],
    peers: [],
  };
  const read = (text: string) => parseDefinition(text, 'dt.yaml', scripts);
  const SAVE = 'snapshot: {save: save-ward}\n';

  it('Should read the what-if commands', () => {
    const text = `${SAVE}whatIf: {commands: [forecast]}\n`;

    expect(read(text).whatIf).toEqual({ commands: ['forecast'] });
  });

  it('Should name no what-if without the section', () => {
    expect(read(SAVE).whatIf).toBeUndefined();
  });

  it('Should not need a manager command for a what-if command', () => {
    const text = `${SAVE}whatIf: {commands: [forecast]}\nmanager: {commands: [create]}\n`;

    expect(read(text).managerCommands).toEqual(['create']);
  });

  it('Should refuse a what-if command that is no command of runner.yaml', () => {
    expect(() => read(`${SAVE}whatIf: {commands: [simulate]}\n`)).toThrow(
      /dt\.yaml[\s\S]*what-if command simulate is not a permitted command/,
    );
  });

  it('Should refuse a what-if command that is the script of a state', () => {
    expect(() =>
      read(`${SAVE}states: {forecast: {}}\nwhatIf: {commands: [forecast]}\n`),
    ).toThrow(
      /what-if command forecast is the script of a state, which runs for the machine; a what-if needs a script of its own/,
    );
  });

  it('Should load a what-if command beside states of other commands', () => {
    const text = `${SAVE}states: {create: {}}\nwhatIf: {commands: [forecast]}\n`;

    expect(read(text).whatIf).toEqual({ commands: ['forecast'] });
  });

  it('Should allow a replay twin without commands or a save script', () => {
    expect(read('whatIf: {replay: true}\n').whatIf).toEqual({
      commands: [],
      replay: true,
    });
  });

  it('Should take both the commands and the replay', () => {
    const text = `${SAVE}whatIf: {commands: [forecast], replay: true}\n`;

    expect(read(text).whatIf).toEqual({ commands: ['forecast'], replay: true });
  });

  it('Should refuse a replay that is no boolean', () => {
    expect(() => read('whatIf: {replay: yes please}\n')).toThrow(
      /Invalid state machine in dt\.yaml/,
    );
  });

  it('Should refuse a what-if without a save script', () => {
    expect(() => read('whatIf: {commands: [forecast]}\n')).toThrow(
      /whatIf needs snapshot\.save, which makes its copy/,
    );
  });

  it('Should refuse an unknown key of the section', () => {
    expect(() => read(`${SAVE}whatIf: {commands: [], every: 1}\n`)).toThrow(
      /Invalid state machine in dt\.yaml/,
    );
  });
});
