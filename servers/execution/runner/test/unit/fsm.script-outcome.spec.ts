import { afterAll, afterEach, describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import ExecaManager from 'src/execa-manager.service';
import scriptOutcome from 'src/fsm/script-outcome';
import { CommandOptions } from 'src/interfaces/command.interface';
import Queue from 'src/queue.service';

describe('Script outcome rows', () => {
  const queue = new Queue();
  const logger = new Logger('test');

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => queue.close());

  // The exit rows of the script of entry 1, run by a manager that ends
  // the run, if told to, and then fails to store it
  async function exits(ends: boolean) {
    jest.spyOn(logger, 'error').mockReturnValue(undefined);
    const manager = {
      newCommand: (_name: string, _key?: string, options?: CommandOptions) => {
        if (ends) {
          options?.ended?.('success', 9);
        }
        return Promise.reject(new Error('database is not open'));
      },
    };
    const { timeline } = queue;
    const script = { state: 'open', entry: 1, env: {}, live: () => true };
    const outcome = await scriptOutcome(
      manager as unknown as ExecaManager,
      { ...script, timeline },
      logger,
    );
    const rows = timeline.rows({ after: 0, limit: 100, count: false });
    return { outcome, exits: rows.map(({ data }) => data) };
  }

  it('Should write one exit row for a run that ended but was not stored', async () => {
    const { outcome, exits: rows } = await exits(true);

    expect(outcome).toBe('failed');
    expect(rows.at(-1)).toEqual({
      state: 'open',
      entry: 1,
      status: 'valid',
      run: 9,
    });
    expect(rows).toHaveLength(1);
  });

  it('Should write a failed exit, without a run, for a script that never ran', async () => {
    const { exits: rows } = await exits(false);

    expect(rows.at(-1)).toEqual({
      state: 'open',
      entry: 1,
      status: 'invalid',
      run: null,
    });
  });
});
