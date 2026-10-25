import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { loadDefinition, parseDefinition } from 'src/fsm/definition';

const permitted = ['create', 'execute', 'terminate'];

const FILE = 'dt.yaml';

const valid = `
events: [start, stop]
states:
  create:
    transitions:
      $success: execute
      $failure: terminate
  execute:
    transitions:
      stop: terminate
  terminate:
`;

const expectInvalid = (text: string, message: string) =>
  expect(() => parseDefinition(text, permitted, FILE)).toThrow(message);

describe('State machine definition', () => {
  it('Should read the events and the transitions of each state', () => {
    const definition = parseDefinition(valid, permitted, FILE);

    expect([...definition.events]).toEqual(['start', 'stop']);
    expect([...definition.states.keys()]).toEqual(permitted);
    expect(definition.states.get('create')).toEqual(
      new Map([
        ['$success', 'execute'],
        ['$failure', 'terminate'],
      ]),
    );
    expect(definition.states.get('terminate')).toEqual(new Map());
  });

  it('Should accept a state with an empty transition map', () => {
    const definition = parseDefinition(
      'states: {create: {transitions: }}',
      permitted,
      FILE,
    );

    expect(definition.states.get('create')).toEqual(new Map());
  });

  it('Should accept a file without events', () => {
    const definition = parseDefinition('states: {create: {}}', permitted, FILE);

    expect(definition.events.size).toBe(0);
  });

  it('Should refuse a file that is not YAML', () => {
    expectInvalid('states: [', 'Invalid state machine');
    expectInvalid('create', 'Invalid state machine');
  });

  it('Should refuse unknown keys', () => {
    expectInvalid('states: {create: {}}\ninitial: create', 'initial');
    expectInvalid('states: {create: {after: execute}}', 'after');
  });

  it('Should refuse a file without states', () => {
    expectInvalid('events: [start]', 'states');
    expectInvalid('states: {}', 'at least one state');
  });

  it.each([
    ['a path', '../create'],
    ['a leading underscore', '__proto__'],
    ['a dollar sign', '$start'],
    ['a long name', 'a'.repeat(65)],
  ])('Should refuse a name with %s', (_, name) => {
    expectInvalid(`events: ['${name}']\nstates: {create: {}}`, 'events');
  });

  it.each([
    ['a state', 'states: {__proto__: {}, create: {}}'],
    ['an event', 'states: {create: {transitions: {__proto__: create}}}'],
  ])('Should refuse __proto__ as %s', (_, text) => {
    expectInvalid(text, '__proto__');
  });

  it('Should refuse two transitions for one event', () => {
    expectInvalid(
      'events: [go]\nstates: {create: {transitions: {go: create, go: create}}}',
      'duplicated mapping key',
    );
  });

  it('Should refuse a state that is not a permitted command', () => {
    expectInvalid('states: {configure: {}}', 'configure');
  });

  it('Should refuse a transition to an undeclared state', () => {
    expectInvalid(
      'events: [start]\nstates: {create: {transitions: {start: execute}}}',
      'execute',
    );
  });

  it('Should refuse a transition on an undeclared event', () => {
    expectInvalid('states: {create: {transitions: {start: create}}}', 'start');
  });

  it('Should refuse a cycle of completion transitions', () => {
    const cycle = `
states:
  create: {transitions: {$success: execute}}
  execute: {transitions: {$failure: create}}`;
    expectInvalid(cycle, 'create -> execute -> create');
  });

  it('Should refuse a completion transition to the same state', () => {
    expectInvalid(
      'states: {create: {transitions: {$success: create}}}',
      'create -> create',
    );
  });

  it('Should allow a cycle that waits for an event', () => {
    const loop = `
events: [reset]
states:
  create: {transitions: {$success: execute}}
  execute: {transitions: {reset: create}}`;
    expect(() => parseDefinition(loop, permitted, FILE)).not.toThrow();
  });
});

describe('State machine file', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Should read the file it is given', () => {
    dir = mkdtempSync(join(tmpdir(), 'fsm-'));
    writeFileSync(join(dir, FILE), valid);

    expect(loadDefinition(join(dir, FILE), permitted)?.states.size).toBe(3);
  });

  it('Should read the state machine of the test scripts', () => {
    const definition = loadDefinition('test/data/scripts/state-machine.yaml', [
      'create',
      'execute',
    ]);

    expect([...(definition?.states.keys() ?? [])]).toEqual([
      'create',
      'execute',
    ]);
  });

  it('Should have no state machine without a file', () => {
    expect(loadDefinition(undefined, permitted)).toBeUndefined();
  });

  it('Should name a file that does not exist', () => {
    dir = mkdtempSync(join(tmpdir(), 'fsm-'));
    const file = join(dir, FILE);

    expect(() => loadDefinition(file, permitted)).toThrow(
      `State machine file ${file} does not exist or is not a file`,
    );
  });

  it('Should refuse a directory as the file', () => {
    dir = mkdtempSync(join(tmpdir(), 'fsm-'));

    expect(() => loadDefinition(dir, permitted)).toThrow(
      `State machine file ${dir} does not exist or is not a file`,
    );
  });

  it('Should name the file in the errors of its definition', () => {
    dir = mkdtempSync(join(tmpdir(), 'fsm-'));
    const file = join(dir, FILE);
    writeFileSync(file, 'states: {configure: {}}');

    expect(() => loadDefinition(file, permitted)).toThrow(
      `Invalid state machine in ${file}:`,
    );
  });
});
