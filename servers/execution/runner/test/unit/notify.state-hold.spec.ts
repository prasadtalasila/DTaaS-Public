import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import StateHold from 'src/notify/state-hold';

describe('State hold', () => {
  let interval: number;
  let flush: jest.Mock<() => void>;
  let hold: StateHold;

  beforeEach(() => {
    jest.useFakeTimers({ now: 0 });
    interval = 1000;
    flush = jest.fn<() => void>();
    hold = new StateHold(() => interval, flush);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('Should send the first document at once', () => {
    expect(hold.due('a')).toBe(true);
    expect(flush).not.toHaveBeenCalled();
  });

  it('Should hold a document with the same control part, then flush', () => {
    hold.due('a');
    jest.advanceTimersByTime(400);

    expect(hold.due('a')).toBe(false);
    expect(hold.due('a')).toBe(false);

    jest.advanceTimersByTime(599);

    expect(flush).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(hold.due('a')).toBe(true);
  });

  it('Should send a document with another control part at once', () => {
    hold.due('a');
    hold.due('a');

    expect(hold.due('b')).toBe(true);

    jest.advanceTimersByTime(5000);

    expect(flush).not.toHaveBeenCalled();
  });

  it('Should send at once when the interval has passed', () => {
    hold.due('a');
    jest.advanceTimersByTime(1000);

    expect(hold.due('a')).toBe(true);
  });

  it('Should hold nothing with an interval of zero', () => {
    interval = 0;
    hold.due('a');

    expect(hold.due('a')).toBe(true);
  });

  it('Should not flush once it is cancelled', () => {
    hold.due('a');
    hold.due('a');
    hold.cancel();
    jest.advanceTimersByTime(5000);

    expect(flush).not.toHaveBeenCalled();
  });
});
