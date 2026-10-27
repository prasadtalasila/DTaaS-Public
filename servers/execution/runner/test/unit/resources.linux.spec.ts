import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  clockTicks,
  parseStat,
  parseStatus,
  readClockTicks,
  readLinux,
} from 'src/resources/linux';

// A stat line whose command name holds spaces and parentheses; utime is
// 250 ticks and stime 50
const STAT =
  '4242 (my (odd) ) name) S 1 4242 4242 0 -1 4194560 120 0 0 0 250 50 0 0 20 0 1 0 98765 2453504 210 18446744073709551615\n';

const STATUS = [
  'Name:\tbusy',
  'VmPeak:\t    2680 kB',
  'VmHWM:\t    1536 kB',
  'VmRSS:\t    1280 kB',
  '',
].join('\n');

describe('Linux resource reads', () => {
  describe('parseStat', () => {
    it('Should add fields 14 and 15 behind a name with spaces and )', () => {
      expect(parseStat(STAT)).toBe(300);
    });

    it.each([
      ['an empty file', ''],
      ['a line without a name', '4242 S 1 4242 4242 0 -1 1 2 3 4 5 250 50'],
      ['a line cut short', '4242 (busy) S 1 4242 4242 0 -1 4194560 120 0'],
      ['times that are not numbers', STAT.replace('250 50', 'x 50')],
    ])('Should read no CPU time from %s', (_, text) => {
      expect(parseStat(text)).toBeUndefined();
    });
  });

  describe('parseStatus', () => {
    it('Should read VmHWM in bytes', () => {
      expect(parseStatus(STATUS)).toBe(1536 * 1024);
    });

    it.each([
      ['a status without VmHWM', 'Name:\tbusy\nVmRSS:\t 1280 kB\n'],
      ['a VmHWM that is not a number', 'VmHWM:\t   many kB\n'],
    ])('Should read no peak from %s', (_, text) => {
      expect(parseStatus(text)).toBeUndefined();
    });
  });

  it('Should know a positive clock tick', () => {
    expect(clockTicks()).toBeGreaterThan(0);
  });

  it('Should take 100 ticks a second without getconf', () => {
    expect(readClockTicks(join(tmpdir(), 'no-getconf'))).toBe(100);
  });

  describe('readLinux', () => {
    let proc: string;

    beforeEach(() => {
      proc = mkdtempSync(join(tmpdir(), 'proc-'));
      mkdirSync(join(proc, '4242'));
    });

    afterEach(() => {
      rmSync(proc, { recursive: true, force: true });
    });

    const write = (stat: string, status: string) => {
      writeFileSync(join(proc, '4242', 'stat'), stat);
      writeFileSync(join(proc, '4242', 'status'), status);
    };

    it('Should read a sample of a process', async () => {
      write(STAT, STATUS);

      await expect(readLinux(4242, proc)).resolves.toEqual({
        cpuSeconds: Math.round((300 / clockTicks()) * 1000) / 1000,
        peakRssBytes: 1536 * 1024,
      });
    });

    it('Should reject malformed files', async () => {
      write('4242 (busy) S', STATUS);

      await expect(readLinux(4242, proc)).rejects.toThrow('4242');
    });

    it('Should reject a process that is gone', async () => {
      await expect(readLinux(4343, proc)).rejects.toThrow();
    });
  });
});
