import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { roundSeconds, type Sample } from './resources.js';

// The clock tick when getconf can not tell it, the usual value on Linux
const DEFAULT_TICKS = 100;

// getconf by its path, so that no directory of PATH can stand in for it
const GETCONF = '/usr/bin/getconf';

// Fields 3 to 13 of /proc/<pid>/stat after the command name, then utime
// and stime, fields 14 and 15, in clock ticks
const STAT_TIMES = /^ (?:\S+ ){11}(\d+) (\d+)\b/;

const VM_HWM = /^VmHWM:\s+(\d+) kB$/m;

let ticks: number | undefined;

// User plus system CPU time in clock ticks, read after the last ), as
// the command name may hold spaces and parentheses
export function parseStat(text: string): number | undefined {
  const end = text.lastIndexOf(')');
  const match = end < 0 ? null : STAT_TIMES.exec(text.slice(end + 1));
  return match === null ? undefined : Number(match[1]) + Number(match[2]);
}

// The peak resident memory in bytes, from VmHWM in kB
export function parseStatus(text: string): number | undefined {
  const match = VM_HWM.exec(text);
  return match === null ? undefined : Number(match[1]) * 1024;
}

function readClockTicks(): number {
  try {
    const value = Number(
      execFileSync(GETCONF, ['CLK_TCK'], { encoding: 'utf8', timeout: 1000 }),
    );
    return value > 0 ? value : DEFAULT_TICKS;
  } catch {
    return DEFAULT_TICKS;
  }
}

// The clock ticks per second, read once
export function clockTicks(): number {
  ticks ??= readClockTicks();
  return ticks;
}

// A sample of the process from the stat and status files of its pid;
// rejects when either is gone or can not be read
export async function readLinux(pid: number, proc = '/proc'): Promise<Sample> {
  const [stat, status] = await Promise.all(
    ['stat', 'status'].map((file) =>
      readFile(join(proc, `${pid}`, file), 'utf8'),
    ),
  );
  const cpu = parseStat(stat);
  const peak = parseStatus(status);
  if (cpu === undefined || peak === undefined) {
    throw new Error(`Can not read the figures of process ${pid}`);
  }
  return { cpuSeconds: roundSeconds(cpu / clockTicks()), peakRssBytes: peak };
}
