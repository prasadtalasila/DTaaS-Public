import { describe, expect, it } from '@jest/globals';
import { parseDefinition } from 'src/fsm/definition';
import StateMachine from 'src/fsm/state-machine';

const definition = parseDefinition(
  `
events: [stop, start]
states:
  create: {transitions: {$success: execute}}
  execute: {transitions: {stop: {state: create, stop: true}}}`,
  ['create', 'execute'],
  'state-machine.yaml',
);

describe('State machine', () => {
  it('Should start without a state', () => {
    const machine = new StateMachine(definition);

    expect(machine.state).toBeUndefined();
    expect(machine.entry).toBe(0);
    expect(machine.next('stop')).toBeUndefined();
  });

  it('Should list the events of the digital twin in order', () => {
    expect(new StateMachine(definition).events).toEqual(['start', 'stop']);
  });

  it('Should know its states and events', () => {
    const machine = new StateMachine(definition);

    expect(machine.hasState('create')).toBe(true);
    expect(machine.hasState('terminate')).toBe(false);
    expect(machine.hasEvent('stop')).toBe(true);
    expect(machine.hasEvent('$success')).toBe(false);
  });

  it('Should count each entry of a state', () => {
    const machine = new StateMachine(definition);

    expect(machine.enter('create')).toBe(1);
    expect(machine.enter('create')).toBe(2);
    expect(machine.state).toBe('create');
  });

  it('Should find the next state of the current state', () => {
    const machine = new StateMachine(definition);
    machine.enter('create');

    expect(machine.next('$success')).toEqual({ state: 'execute', stop: false });
    expect(machine.next('stop')).toBeUndefined();
    machine.enter('execute');
    expect(machine.next('stop')).toEqual({ state: 'create', stop: true });
  });
});
