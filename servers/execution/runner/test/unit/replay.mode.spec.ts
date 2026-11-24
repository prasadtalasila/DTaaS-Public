import { describe, expect, it } from '@jest/globals';
import ReplayMode, { listenHost } from 'src/replay/replay-mode';

const ORIGIN = { of: 'hospital-1', time: '2026-11-22T22:00:00.000Z' };

// A mode whose clock reads the values given, one at each call
function mode(scale: number, ...readings: number[]): ReplayMode {
  return new ReplayMode(scale, () => readings.shift() ?? 0);
}

describe('The mode of a replay twin', () => {
  it('Should stand for nothing before the reinstate', () => {
    const replay = mode(1);

    expect(replay.describe()).toBeNull();
    expect(replay.at()).toBeUndefined();
    expect(replay.variables()).toEqual({
      DT_REPLAY_OF: '',
      DT_TIME_SCALE: '1',
    });
  });

  it('Should name the snapshot once it began', () => {
    const replay = mode(1, 1000);
    replay.begin(ORIGIN);

    expect(replay.describe()).toEqual(ORIGIN);
    expect(replay.variables().DT_REPLAY_OF).toBe('hospital-1');
  });

  it('Should run its time at the scale from the time of the save', () => {
    const replay = mode(60, 1000, 3000);
    replay.begin(ORIGIN);

    expect(replay.at()).toBe('2026-11-22T22:02:00.000Z');
  });

  it('Should run its time slower below 1', () => {
    const replay = mode(0.5, 0, 4000);
    replay.begin(ORIGIN);

    expect(replay.at()).toBe('2026-11-22T22:00:02.000Z');
    expect(replay.variables().DT_TIME_SCALE).toBe('0.5');
  });

  it('Should read the clock of the process by default', () => {
    const replay = new ReplayMode(1);
    replay.begin(ORIGIN);

    expect(Date.parse(replay.at() ?? '')).toBeGreaterThanOrEqual(
      Date.parse(ORIGIN.time),
    );
  });
});

describe('The host of a runner', () => {
  it('Should listen on the loopback address in a replay twin only', () => {
    expect(listenHost(new ReplayMode(10))).toBe('127.0.0.1');
    expect(listenHost(undefined)).toBeUndefined();
  });
});
