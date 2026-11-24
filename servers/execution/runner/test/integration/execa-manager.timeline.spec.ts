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
import ExecaManager from 'src/execa-manager.service';
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
    const result = manager.newCommand(name, key, {
      onRun: (id) => named.push(id),
    });
    const atOnce = [...named];
    await Promise.allSettled([result]);
    return { named: atOnce, result };
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
    expect((await submit('create', 'k-1')).named).toEqual([1]);
    expect((await submit('create', 'k-1')).named).toEqual([1]);
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
