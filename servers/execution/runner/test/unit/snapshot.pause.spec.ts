import { describe, expect, it, jest } from '@jest/globals';
import { ArgumentsHost, HttpException } from '@nestjs/common';
import { Route, routes } from 'src/auth/roles';
import Pause, { saving, SavingException } from 'src/snapshot/pause';
import SavingFilter from 'src/snapshot/saving.filter';

// The routes that a save refuses; every other route is answered
const CHANGING: Route[] = [
  'transition',
  'event',
  'escalate',
  'execute',
  'stop',
  'set-parameters',
  'set-peers',
  'set-properties',
  'save',
];

const READS = routes.filter((route) => !CHANGING.includes(route));

// A promise that has settled
const settled = <T>(promise: Promise<T>): Promise<boolean> =>
  Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => {
      setImmediate(() => resolve(false));
    }),
  ]);

describe('Pause of a save', () => {
  it('Should refuse no route while no save runs', () => {
    const pause = new Pause();

    expect(pause.saving).toBe(false);
    expect(routes.filter((route) => pause.refuses(route))).toEqual([]);
  });

  it('Should refuse each changing route while a save runs', () => {
    const pause = new Pause();
    pause.begin();

    expect(pause.saving).toBe(true);
    expect(CHANGING.filter((route) => pause.refuses(route))).toEqual(CHANGING);
    expect(READS.filter((route) => pause.refuses(route))).toEqual([]);
    expect(READS).toEqual(expect.arrayContaining(['snapshots', 'health']));
  });

  it('Should refuse no route once the save ended', () => {
    const pause = new Pause();
    pause.begin();
    pause.end();

    expect(pause.saving).toBe(false);
    expect(pause.refuses('transition')).toBe(false);
  });

  it('Should refuse a second save with a 503 saving', () => {
    const pause = new Pause();
    pause.begin();

    try {
      pause.begin();
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(503);
      expect((error as HttpException).getResponse()).toEqual({
        status: 'saving',
      });
    }
    expect.assertions(2);
  });

  it('Should pass a value on at once while no save runs', async () => {
    const pause = new Pause();

    expect(await pause.hold(Promise.resolve('success'))).toBe('success');
  });

  it('Should hold the values that come during a save, in their order', async () => {
    const pause = new Pause();
    const order: string[] = [];
    pause.begin();
    const first = pause.hold(Promise.resolve('first'));
    const second = pause.hold(Promise.resolve('second'));
    void first.then((value) => order.push(value));
    void second.then((value) => order.push(value));

    expect(await settled(first)).toBe(false);
    pause.end();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });

  it('Should hold a script that began before the save and ends in it', async () => {
    const pause = new Pause();
    let end: (value: string) => void = () => undefined;
    const held = pause.hold(
      new Promise<string>((resolve) => {
        end = resolve;
      }),
    );
    pause.begin();
    end('success');

    expect(await settled(held)).toBe(false);
    pause.end();
    expect(await held).toBe('success');
  });
});

describe('Refusal of a change during a save', () => {
  it('Should answer 503 saving with a Retry-After of 1 s', () => {
    const headers: Record<string, unknown> = {};
    const sent: unknown[] = [];
    const response = {
      setHeader: (name: string, value: unknown) => {
        headers[name] = value;
        return response;
      },
      status: (code: number) => {
        sent.push(code);
        return response;
      },
      json: (body: unknown) => sent.push(body),
    };
    const host = { switchToHttp: () => ({ getResponse: () => response }) };

    new SavingFilter().catch(saving(), host as unknown as ArgumentsHost);

    expect(headers).toEqual({ 'Retry-After': 1 });
    expect(sent).toEqual([503, { status: 'saving' }]);
  });

  it('Should throw the refusal that the filter answers for a second save', () => {
    const pause = new Pause();
    pause.begin();

    expect(() => pause.begin()).toThrow(SavingException);
  });
});

describe('Deferred work of a save', () => {
  it('Should do the work at once while no save runs', () => {
    const work = jest.fn();

    new Pause().defer(work, () => undefined);

    expect(work).toHaveBeenCalledTimes(1);
  });

  it('Should do the work after the held completions that came first', async () => {
    const pause = new Pause();
    const order: string[] = [];
    pause.begin();
    void pause.hold(Promise.resolve('completion')).then((v) => order.push(v));
    await new Promise(setImmediate);
    pause.defer(
      () => order.push('event'),
      () => undefined,
    );
    pause.end();
    await new Promise(setImmediate);

    expect(order).toEqual(['completion', 'event']);
  });
});
