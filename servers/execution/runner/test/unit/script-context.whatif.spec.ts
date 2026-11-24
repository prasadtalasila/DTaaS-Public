import { describe, expect, it } from '@jest/globals';
import { parseDefinition } from 'src/fsm/definition';
import { RunnerContext, scriptEnvironment } from 'src/fsm/script-context';

const definition = parseDefinition(
  "env:\n  WHERE: '${RUNNER_URL}/fsm'\nstates:\n  idle:",
  'dt.yaml',
  { commands: ['idle'], peers: [] },
);

const machine = {
  id: 'dt-1',
  url: 'http://127.0.0.1:5000',
  definition,
};

describe('Script environment of a what-if', () => {
  const whatIf = {
    command: 'idle',
    ...machine,
    token: 'token-1',
    whatIf: '/run/snapshots/what-if/20261123T101502120Z',
    inherited: { RUNNER_URL: 'u', runner_token: 't', PATH: '/bin' },
  };

  it('Should give the mode and the copy', () => {
    expect(scriptEnvironment(whatIf)).toMatchObject({
      DT_MODE: 'what-if',
      DT_WHATIF_DIR: '/run/snapshots/what-if/20261123T101502120Z',
      DT_ID: 'dt-1',
      PATH: '/bin',
    });
  });

  it('Should give no address or token, given or inherited', () => {
    const names = Object.keys(scriptEnvironment(whatIf));

    expect(names.filter((name) => /^runner_/i.test(name))).toEqual([]);
  });

  it('Should interpolate no address into a declared value', () => {
    expect(scriptEnvironment(whatIf).WHERE).toBe('/fsm');
  });

  it('Should give the live mode and the address to every other script', () => {
    expect(scriptEnvironment({ ...whatIf, whatIf: undefined })).toMatchObject({
      DT_MODE: 'live',
      RUNNER_URL: 'http://127.0.0.1:5000',
      RUNNER_TOKEN: 'token-1',
    });
  });

  it('Should hand the copy on from the runner context', () => {
    const context = new RunnerContext();
    context.setApi('http://127.0.0.1:5000', 'token-1');

    expect(context.environment('x', { whatIf: '/copy' })).toMatchObject({
      DT_MODE: 'what-if',
      DT_WHATIF_DIR: '/copy',
    });
  });
});
