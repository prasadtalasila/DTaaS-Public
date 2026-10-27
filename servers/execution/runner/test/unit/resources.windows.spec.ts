import { PassThrough } from 'node:stream';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { NO_RESOURCES } from 'src/resources/resources';
import {
  samplerScript,
  SamplerProcess,
  windowsSampler,
} from 'src/resources/windows';

type Ending = { failed: boolean; isTerminated: boolean };

// A sampler whose output the test writes, and which ends as the test says
function fakeSampler() {
  const stdout = new PassThrough();
  let end: (ending: Ending) => void = () => undefined;
  const ended = new Promise<Ending>((resolve) => {
    end = resolve;
  });
  const kill = jest.fn(() => true);
  const sampler: SamplerProcess = Object.assign(ended, { stdout, kill });
  const spawn = jest.fn((_script: string) => sampler);
  // the lines reach the watch through readline, a few turns later
  const print = async (...lines: string[]) => {
    stdout.write(lines.map((line) => `${line}\r\n`).join(''));
    await new Promise(setImmediate);
  };
  return { spawn, kill, print, end };
}

describe('Windows sampler', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Should take only numbers into its script', () => {
    const script = samplerScript(4242, 1761576000123);

    expect(script).toContain('Get-Process -Id 4242');
    expect(script).toContain('-gt 1761576000123');
  });

  it('Should start one sampler for the pid and start time', () => {
    const { spawn } = fakeSampler();

    windowsSampler(4242, 1761576000123, spawn);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(samplerScript(4242, 1761576000123));
  });

  it('Should keep the last line and prefer PeakWorkingSet64', async () => {
    const { spawn, print } = fakeSampler();
    const watch = windowsSampler(4242, 0, spawn);

    await print('1562500 74158080 74158080', '4690000 80191488 115646464');

    expect(watch.finish()).toEqual({
      cpuSeconds: 0.469,
      peakRssBytes: 115646464,
    });
  });

  it('Should take the largest working set for a peak of 0', async () => {
    const { spawn, print } = fakeSampler();
    const watch = windowsSampler(4242, 0, spawn);

    await print('10000000 2048 0', '20000000 8192 0', '30000000 4096 0');

    expect(watch.finish()).toEqual({ cpuSeconds: 3, peakRssBytes: 8192 });
  });

  it('Should have no memory for a line without it', async () => {
    const { spawn, print } = fakeSampler();
    const watch = windowsSampler(4242, 0, spawn);

    await print('12031250 0 0');

    expect(watch.finish()).toEqual({ cpuSeconds: 1.203, peakRssBytes: null });
  });

  it('Should ignore a malformed line and log it once', async () => {
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    const { spawn, print } = fakeSampler();
    const watch = windowsSampler(4242, 0, spawn);

    await print('10000000 2048 2048', '19375000  ', '1,5 2048 2048');

    expect(debug).toHaveBeenCalledTimes(1);
    expect(watch.finish()).toEqual({ cpuSeconds: 1, peakRssBytes: 2048 });
  });

  it('Should kill the sampler on finish without waiting for it', () => {
    const { spawn, kill } = fakeSampler();
    const watch = windowsSampler(4242, 0, spawn);

    expect(watch.finish()).toBe(NO_RESOURCES);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['log a sampler that failed', true, false, 1],
    ['not log a sampler that it killed', true, true, 0],
    ['not log a sampler that ended', false, false, 0],
  ])('Should %s', async (_, failed, isTerminated, logs) => {
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    const { spawn, end } = fakeSampler();
    windowsSampler(4242, 0, spawn);

    end({ failed, isTerminated });
    await new Promise(setImmediate);

    expect(debug).toHaveBeenCalledTimes(logs);
  });
});
