import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { execa } from 'execa';
import {
  debugOnce,
  NO_RESOURCES,
  roundSeconds,
  type ResourceWatch,
  type Sample,
  type ScriptResources,
} from './resources.js';

// TotalProcessorTime.Ticks counts 100 ns
const TICKS_PER_SECOND = 1e7;

// TotalProcessorTime.Ticks, WorkingSet64 and PeakWorkingSet64
const LINE = /^(\d+) (\d+) (\d+)$/;

// The sampler as started: its output, a way to end it, and its result
export type SamplerProcess = PromiseLike<{
  failed: boolean;
  isTerminated: boolean;
}> & {
  stdout: Readable;
  kill(): boolean;
};

// A PowerShell loop that holds the process, so that TotalProcessorTime
// stays readable after the exit, and prints a line at once, after each
// wait of up to 500 ms, and after the exit, with the memory figures of
// the last refresh while it ran. It prints nothing for a process that
// started after start, as Windows reuses a pid quickly. Only numbers
// reach the script, which prints integers, so no culture formats them.
export const samplerScript = (pid: number, start: number): string => `
$ErrorActionPreference = 'Stop'
$p = Get-Process -Id ${pid}
$null = $p.Handle
if (([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds() -gt ${start}) { exit }
$ws = 0; $peak = 0
do {
  $p.Refresh()
  if ($null -ne $p.PeakWorkingSet64) { $ws = $p.WorkingSet64; $peak = $p.PeakWorkingSet64 }
  "$($p.TotalProcessorTime.Ticks) $ws $peak"
} until ($p.WaitForExit(500))
"$($p.TotalProcessorTime.Ticks) $ws $peak"`;

const spawnSampler = (script: string): SamplerProcess =>
  execa(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, reject: false, buffer: { stdout: false } },
  );

// Keeps the last line of the sampler as a sample; a PeakWorkingSet64 of
// 0 gives way to the largest WorkingSet64 seen
class SamplerWatch implements ResourceWatch {
  private latest: Sample | undefined;

  private largestSet = 0;

  private readonly log = debugOnce();

  constructor(private readonly sampler: SamplerProcess) {
    createInterface({ input: sampler.stdout }).on('line', (line) =>
      this.take(line),
    );
    void sampler.then(({ failed, isTerminated }) => {
      if (failed && !isTerminated) {
        this.log('The resource sampler failed');
      }
    });
  }

  // Ends the sampler without waiting for it
  finish(): ScriptResources {
    this.sampler.kill();
    return this.latest ?? NO_RESOURCES;
  }

  private take(line: string): void {
    const match = LINE.exec(line.trim());
    if (match === null) {
      this.log(`Ignored a line of the resource sampler: ${line}`);
      return;
    }
    const [ticks, set, peak] = match.slice(1).map(Number);
    this.largestSet = Math.max(this.largestSet, set);
    this.latest = {
      cpuSeconds: roundSeconds(ticks / TICKS_PER_SECOND),
      peakRssBytes: peak || this.largestSet || null,
    };
  }
}

// Samples the process of a pid from the time just after its start
export function windowsSampler(
  pid: number,
  start: number,
  spawn = spawnSampler,
): ResourceWatch {
  return new SamplerWatch(spawn(samplerScript(pid, start)));
}
