import { Logger } from '@nestjs/common';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { meterFor } from 'src/resources/meter';
import PollingWatch from 'src/resources/polling-watch';
import { NO_RESOURCES, NO_WATCH, Sample } from 'src/resources/resources';

const sample = (cpuSeconds: number): Sample => ({
  cpuSeconds,
  peakRssBytes: 1024,
});

const failing = () => Promise.reject(new Error('ENOENT'));

describe('PollingWatch', () => {
  let debug: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.useFakeTimers();
    debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('Should read at once and keep the last sample', async () => {
    const read = jest
      .fn<() => Promise<Sample>>()
      .mockResolvedValueOnce(sample(0.01))
      .mockResolvedValueOnce(sample(0.5));
    const watch = new PollingWatch(read, 500);
    await jest.advanceTimersByTimeAsync(0);

    expect(read).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(500);

    expect(watch.finish()).toEqual(sample(0.5));
  });

  it('Should keep the last sample after a failed read', async () => {
    const read = jest
      .fn<() => Promise<Sample>>()
      .mockResolvedValueOnce(sample(0.25))
      .mockImplementation(failing);
    const watch = new PollingWatch(read, 500);
    await jest.advanceTimersByTimeAsync(1000);

    expect(read).toHaveBeenCalledTimes(3);
    expect(watch.finish()).toEqual(sample(0.25));
  });

  it('Should skip a tick while a read is pending', async () => {
    let done: (value: Sample) => void = () => undefined;
    const read = jest.fn(
      () =>
        new Promise<Sample>((resolve) => {
          done = resolve;
        }),
    );
    const watch = new PollingWatch(read, 500);
    await jest.advanceTimersByTimeAsync(1500);

    expect(read).toHaveBeenCalledTimes(1);
    done(sample(1));
    await jest.advanceTimersByTimeAsync(500);

    expect(read).toHaveBeenCalledTimes(2);
    expect(watch.finish()).toEqual(sample(1));
  });

  it('Should log repeated failures once and measure nothing', async () => {
    const watch = new PollingWatch(failing, 500);
    await jest.advanceTimersByTimeAsync(1500);

    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
    expect(watch.finish()).toBe(NO_RESOURCES);
  });

  it('Should read no more after finish', async () => {
    const read = jest.fn(() => Promise.resolve(sample(0.1)));
    const watch = new PollingWatch(read, 500);
    await jest.advanceTimersByTimeAsync(0);

    watch.finish();
    await jest.advanceTimersByTimeAsync(2000);

    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('meterFor', () => {
  it.each(['darwin', 'freebsd'] as const)(
    'Should measure nothing on %s',
    (platform) => {
      expect(meterFor(platform)(process.pid, Date.now()).finish()).toBe(
        NO_RESOURCES,
      );
    },
  );

  it.each(['linux', 'win32'] as const)(
    'Should measure nothing on %s for a process that did not start',
    (platform) => {
      expect(meterFor(platform)(undefined, Date.now())).toBe(NO_WATCH);
    },
  );
});
