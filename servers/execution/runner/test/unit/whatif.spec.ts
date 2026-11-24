import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { refuseOtherMode } from 'src/command-result';
import { endOf, parsedResult } from 'src/dto/whatif.dto';
import { NO_RESOURCES } from 'src/resources/resources';
import { presentOf, Twin } from 'src/whatif/present';
import WhatIfs, { WhatIfHost } from 'src/whatif/whatifs';

const rejects = () => Promise.reject(new Error('the database closed'));

// A host whose save makes the directory, and whose run is the one given
function host(directory: string, run: () => Promise<unknown> = rejects) {
  const saveInto = jest.fn(
    async (copy: string, _time: string, { whatIf }: { whatIf?: unknown }) => {
      mkdirSync(copy, { recursive: true });
      expect(whatIf).toBeInstanceOf(Function);
    },
  );
  const newCommand = jest.fn(
    (
      _name: string,
      _key: undefined,
      { onRun }: { onRun: (id: number) => void },
    ) => {
      onRun(7);
      return run();
    },
  );
  const fsm = {
    declared: () => ({ whatIf: { commands: ['forecast'] } }),
    environment: () => ({}),
    manager: {
      newCommand,
      isRunning: () => false,
      stop: () => Promise.resolve([]),
    },
  };
  return {
    config: { access: () => ({}), getSnapshots: () => ({ directory }) },
    fsm,
    queue: {
      timeline: {
        command: (_: unknown, submit: (onRun: () => void) => unknown) =>
          submit(() => undefined),
      },
    },
    snapshots: { checked: () => ({ config: { directory } }), saveInto },
    twin: {},
  } as unknown as WhatIfHost;
}

describe('What-ifs', () => {
  let dir: string;

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should remove the copy and tell no end of a run that rejects', async () => {
    dir = mkdtempSync(join(tmpdir(), 'whatif-'));
    const error = jest.spyOn(Logger.prototype, 'error').mockReturnValue();
    const whatIfs = new WhatIfs(host(dir));
    const listener = jest.fn();
    whatIfs.onEnd(listener);

    const reply = await whatIfs.ask({ name: 'forecast' });
    await whatIfs.stop();

    expect(reply).toEqual({ id: 7, name: 'forecast', status: 'running' });
    expect(readdirSync(join(dir, 'what-if'))).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      'The what-if forecast failed: Error: the database closed',
    );
  });
});

describe('The end of a what-if', () => {
  let dir: string;
  const RESULT = ['success', new Map([['stdout', '1']]), 0, NO_RESOURCES];

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should tell no end of a what-if that the shutdown stopped', async () => {
    dir = mkdtempSync(join(tmpdir(), 'whatif-'));
    let finish = (_result: unknown) => undefined as void;
    const run = () => new Promise((resolve) => (finish = resolve));
    const whatIfs = new WhatIfs(host(dir, run));
    const listener = jest.fn();
    whatIfs.onEnd(listener);
    await whatIfs.ask({ name: 'forecast' });

    const stopped = whatIfs.stop();
    finish(RESULT);
    await stopped;

    expect(listener).not.toHaveBeenCalled();
    expect(readdirSync(join(dir, 'what-if'))).toEqual([]);
    await expect(whatIfs.ask({ name: 'forecast' })).rejects.toMatchObject({
      response: { status: 'shutting down' },
    });
  });

  it('Should log a copy that can not be removed, and still tell the end', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) {
      expect(process.platform).toBeDefined();
      return;
    }
    dir = mkdtempSync(join(tmpdir(), 'whatif-'));
    const error = jest.spyOn(Logger.prototype, 'error').mockReturnValue();
    const root = join(dir, 'what-if');
    const run = () => {
      chmodSync(root, 0o555);
      return Promise.resolve(RESULT);
    };
    const whatIfs = new WhatIfs(host(dir, run));
    const ended = new Promise((resolve) => whatIfs.onEnd(resolve));

    await whatIfs.ask({ name: 'forecast' });

    expect(await ended).toMatchObject({ id: 7, result: 1 });
    expect(error.mock.calls[0][0]).toMatch(/^Could not remove the copy /);
    chmodSync(root, 0o755);
  });
});

describe('Documents and results of a what-if', () => {
  it('Should answer as GET /fsm for a document that needs a state machine', () => {
    const twin = {
      state: () => ({ id: 'dt-1' }),
      properties: () => ({ document: () => undefined }),
      peers: () => ({ document: () => ({}) }),
    } as unknown as Twin;

    const present = presentOf(twin, { parameters: () => undefined } as never);

    const none = { status: 'no state machine', state: null };
    expect(present.parameters).toEqual(none);
    expect(present.properties).toEqual(none);
  });

  it.each([
    ['{"free":1}', { free: 1 }],
    ['3', 3],
    ['no json', 'no json'],
    ['', ''],
  ])('Should take %j as the result %j', (stdout, result) => {
    expect(parsedResult(stdout)).toEqual(result);
  });

  it('Should take no output as an empty result', () => {
    const run = { id: 1, name: 'forecast' };

    expect(endOf(run, ['stopped', new Map(), null, NO_RESOURCES])).toEqual({
      ...run,
      status: 'stopped',
      exitCode: null,
      result: '',
    });
  });
});

describe('Two runs of one command in two modes', () => {
  it.each([
    ['what-if', undefined, 'what-if running'],
    [undefined, 'what-if', 'command running'],
    ['what-if-copy', 'what-if', 'command running'],
  ] as const)(
    'Should refuse a %s run joined by a %s run',
    (running, asked, status) => {
      expect(() => refuseOtherMode(running, asked)).toThrow(status);
    },
  );

  it('Should let a run join a run of its mode', () => {
    expect(() => refuseOtherMode('what-if', 'what-if')).not.toThrow();
    expect(() => refuseOtherMode(undefined, undefined)).not.toThrow();
  });
});
