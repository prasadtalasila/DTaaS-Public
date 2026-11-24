import { Test, TestingModule } from '@nestjs/testing';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import Keyv from 'keyv';
import { Logger } from '@nestjs/common';
import ExecaManager from 'src/execa-manager.service';
import scriptOutcome from 'src/fsm/script-outcome';
import Queue from 'src/queue.service';
import Config from 'src/config/configuration.service';
import { configFilename } from 'test/utils';

// Each test runs scripts, and PowerShell takes a second or more to start
// on a loaded Windows host
jest.setTimeout(30000);

describe('Runs that the execution manager names to the timeline', () => {
  let manager: ExecaManager;
  let queue: Queue;

  // The runs that a request of the command was named at once, and its
  // result, settled
  async function submit(name: string, key?: string) {
    const named: number[] = [];
    const stored: boolean[] = [];
    const result = manager.newCommand(name, key, {
      onRun: (id, repeat) => {
        named.push(id);
        stored.push(repeat === true);
      },
    });
    const atOnce = [...named];
    await Promise.allSettled([result]);
    return { named: atOnce, stored, result };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExecaManager, Queue, Config],
    }).compile();
    manager = module.get<ExecaManager>(ExecaManager);
    queue = module.get<Queue>(Queue);
    const options = new Keyv();
    await options.set('configFile', configFilename);
    await module.get<Config>(Config).loadConfig(options);
  });

  afterEach(async () => {
    await manager.stop();
    queue.close();
  });

  it('Should name a new run, and a repeat of its key, at once', async () => {
    expect(await submit('create', 'k-1')).toMatchObject({
      named: [1],
      stored: [false],
    });
    expect(await submit('create', 'k-1')).toMatchObject({
      named: [1],
      stored: [true],
    });
    expect((await submit('create')).named).toEqual([2]);
  });

  it('Should name no run for a refused request', async () => {
    await submit('create', 'k-1');

    const other = await submit('fail', 'k-1');
    await expect(other.result).rejects.toThrow('invalid command');
    expect(other.named).toEqual([]);
  });

  it('Should name the run that a request joins, and none it refuses', async () => {
    const loop = manager.newCommand('loop');
    const named: number[][] = [[], []];
    const joined = manager.newCommand('loop', undefined, {
      onRun: (id) => named[0].push(id),
    });
    const refused = manager.newCommand('loop', undefined, {
      input: '{}\n',
      onRun: (id) => named[1].push(id),
    });

    await expect(refused).rejects.toThrow('command running');
    await manager.stop('loop');
    await Promise.allSettled([loop, joined]);
    expect(named).toEqual([[1], []]);
  });

  it('Should write the exit row of a state script that joined a run', async () => {
    const loop = manager.newCommand('loop');
    const { timeline } = queue;
    const script = { state: 'loop', entry: 3, env: {}, live: () => true };
    const joined = scriptOutcome(
      manager,
      { ...script, timeline },
      new Logger('test'),
    );
    await manager.stop('loop');
    await Promise.allSettled([loop]);

    expect(await joined).toBe('stopped');
    const rows = timeline.rows({ after: 0, limit: 100, count: false });
    expect(rows.map(({ kind, data }) => [kind, data])).toEqual([
      ['exit', { state: 'loop', entry: 3, status: 'stopped', run: 1 }],
    ]);
  });

  it('Should signal the end of a run before it is stored', async () => {
    const stored: boolean[] = [];
    const ended = jest.fn((_outcome: string, _id: number) => {
      stored.push(queue.activeCommand()?.finished === true);
    });

    await manager.newCommand('create', undefined, { ended });

    expect(ended).toHaveBeenCalledWith('success', 1);
    expect(stored).toEqual([false]);
  });
});
