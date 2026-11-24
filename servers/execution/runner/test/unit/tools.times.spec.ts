import { describe, expect, it } from '@jest/globals';
import { gap, isoOf, timeSchema } from 'src/tools/times';

const FROM = '2026-11-22T22:00:00.000Z';

describe('The times of a replay', () => {
  it('Should read a time in the form of the names of snapshots', () => {
    expect(isoOf('20261123T060000000Z')).toBe('2026-11-23T06:00:00.000Z');
    expect(timeSchema.parse('20261123T060000120Z')).toBe(
      '2026-11-23T06:00:00.120Z',
    );
    expect(timeSchema.safeParse('20261131T060000000Z').success).toBe(false);
    expect(timeSchema.safeParse('x').error?.issues).toHaveLength(1);
    expect(timeSchema.safeParse('2026-11-23T06:00:00.000Z').success).toBe(
      false,
    );
  });

  it('Should divide a gap by the speed, and never wait for the past', () => {
    expect(gap(FROM, '2026-11-22T23:00:00.000Z', 60)).toBe(60000);
    expect(gap(FROM, '2026-11-22T21:00:00.000Z', 1)).toBe(0);
  });
});
