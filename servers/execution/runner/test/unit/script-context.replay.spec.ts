import { describe, expect, it } from '@jest/globals';
import { RunnerContext } from 'src/fsm/script-context';
import ReplayMode from 'src/replay/replay-mode';

// The context of a runner dt-1.replay, a replay twin at the scale given
// unless the scale is undefined
function context(scale?: number): RunnerContext {
  const replay = scale === undefined ? undefined : new ReplayMode(scale);
  replay?.begin({ of: 'dt-1', time: '2026-11-22T22:00:00.000Z' });
  const result = new RunnerContext();
  result.load({ getId: () => 'dt-1.replay', replay: () => replay });
  result.setApi('http://127.0.0.1:5000', 'token-1');
  return result;
}

describe('Script environment of a replay twin', () => {
  it('Should give the what-if mode, the twin and the scale', () => {
    expect(context(60).environment('work')).toMatchObject({
      DT_MODE: 'what-if',
      DT_REPLAY_OF: 'dt-1',
      DT_TIME_SCALE: '60',
      DT_ID: 'dt-1.replay',
    });
  });

  it('Should keep the address and the token, for its own machine', () => {
    expect(context(1).environment('work')).toMatchObject({
      RUNNER_URL: 'http://127.0.0.1:5000',
      RUNNER_TOKEN: 'token-1',
    });
  });

  it('Should give no copy of a what-if', () => {
    expect(context(1).environment('work')).not.toHaveProperty('DT_WHATIF_DIR');
  });

  it('Should give a what-if in it the copy, as in any twin', () => {
    expect(context(1).environment('x', { whatIf: '/copy' })).toMatchObject({
      DT_MODE: 'what-if',
      DT_WHATIF_DIR: '/copy',
    });
  });

  it('Should give neither variable to a twin that is no replay twin', () => {
    const env = context().environment('work');

    expect(env.DT_MODE).toBe('live');
    expect(env).not.toHaveProperty('DT_REPLAY_OF');
    expect(env).not.toHaveProperty('DT_TIME_SCALE');
  });
});
