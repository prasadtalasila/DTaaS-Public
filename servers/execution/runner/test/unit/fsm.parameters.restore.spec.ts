import { describe, expect, it } from '@jest/globals';
import { parseDefinition } from 'src/fsm/definition';
import Parameters from 'src/fsm/parameters';

const { parameters } = parseDefinition(
  `
parameters:
  scope: {type: string, enum: [single, multi], default: single, controllable: true}
  capacity: {type: number, default: 20, controllable: true}
  label: {type: string, default: x, controllable: true}
  beds: {type: number, default: 2}
states:
  create: {}`,
  'state-machine.yaml',
  { commands: ['create'], peers: [] },
);

describe('Restored parameter values', () => {
  it('Should take the stored values that fit their declarations', () => {
    const declared = new Parameters(parameters);

    expect(declared.restore({ scope: 'multi', capacity: 30 })).toEqual([]);
    expect(declared.values()).toEqual({
      scope: 'multi',
      capacity: 30,
      label: 'x',
      beds: 2,
    });
  });

  it('Should drop the values that no longer fit, which keep their defaults', () => {
    const declared = new Parameters(parameters);

    const dropped = declared.restore({
      removed: 'gone',
      capacity: 'many',
      scope: 'triple',
      label: 'y',
    });

    expect(dropped).toEqual(['removed', 'capacity', 'scope']);
    expect(declared.values()).toEqual({
      scope: 'single',
      capacity: 20,
      label: 'y',
      beds: 2,
    });
  });

  it('Should drop the values of parameters that are not controllable, which keep their defaults', () => {
    const declared = new Parameters(parameters);

    expect(declared.restore({ beds: 5, label: 'y' })).toEqual(['beds']);
    expect(declared.values()).toEqual({
      scope: 'single',
      capacity: 20,
      label: 'y',
      beds: 2,
    });
  });
});
