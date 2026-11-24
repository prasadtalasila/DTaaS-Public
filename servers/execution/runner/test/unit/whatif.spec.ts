import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { endOf, parsedResult } from 'src/dto/whatif.dto';
import { NO_RESOURCES } from 'src/resources/resources';
import { presentOf, Twin } from 'src/whatif/present';
import WhatIfs, { WhatIfHost } from 'src/whatif/whatifs';

// A host whose save makes the directory and whose run rejects
function host(directory: string) {
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
      return Promise.reject(new Error('the database closed'));
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
