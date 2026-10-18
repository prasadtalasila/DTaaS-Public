import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import {
  DEFINITION_FILE,
  loadDefinition,
  parseDefinition,
} from 'src/fsm/definition';

const permitted = ['create', 'execute', 'terminate'];

const valid = `
events: [start, stop]
states:
  create:
    on:
      $success: execute
      $failure: terminate
  execute:
    on:
      stop: terminate
  terminate:
`;

const expectInvalid = (text: string, message: string) =>
  expect(() => parseDefinition(text, permitted)).toThrow(message);

describe('State machine definition', () => {
  it('Should read the events and the transitions of each state', () => {
    const definition = parseDefinition(valid, permitted);

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

  it('Should accept a file without events', () => {
    const definition = parseDefinition('states: {create: {}}', permitted);

    expect(definition.events.size).toBe(0);
  });

  it('Should refuse a file that is not YAML', () => {
    expectInvalid('states: [', 'Invalid state machine');
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

  it('Should refuse a state that is not a permitted command', () => {
    expectInvalid('states: {configure: {}}', 'configure');
  });

  it('Should refuse a transition to an undeclared state', () => {
    expectInvalid(
      'events: [start]\nstates: {create: {on: {start: execute}}}',
      'execute',
    );
  });

  it('Should refuse a transition on an undeclared event', () => {
    expectInvalid('states: {create: {on: {start: create}}}', 'start');
  });

  it('Should refuse a cycle of completion transitions', () => {
    const cycle = `
states:
  create: {on: {$success: execute}}
  execute: {on: {$failure: create}}`;
    expectInvalid(cycle, 'create -> execute -> create');
  });

  it('Should refuse a completion transition to the same state', () => {
    expectInvalid(
      'states: {create: {on: {$success: create}}}',
      'create -> create',
    );
  });

  it('Should allow a cycle that waits for an event', () => {
    const loop = `
events: [reset]
states:
  create: {on: {$success: execute}}
  execute: {on: {reset: create}}`;
    expect(() => parseDefinition(loop, permitted)).not.toThrow();
  });
});

describe('State machine file', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Should read the file of the script folder', () => {
    dir = mkdtempSync(join(tmpdir(), 'fsm-'));
    writeFileSync(join(dir, DEFINITION_FILE), valid);

    expect(loadDefinition(dir, permitted)?.states.size).toBe(3);
  });

  it('Should read the state machine of the test scripts', () => {
    const definition = loadDefinition('test/data/scripts', [
      'create',
      'execute',
    ]);

    expect([...(definition?.states.keys() ?? [])]).toEqual([
      'create',
      'execute',
    ]);
  });

  it('Should have no state machine without the file', () => {
    dir = mkdtempSync(join(tmpdir(), 'fsm-'));

    expect(loadDefinition(dir, permitted)).toBeUndefined();
  });
});
