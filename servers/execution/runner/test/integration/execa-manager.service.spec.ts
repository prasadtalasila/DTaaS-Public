import { Test, TestingModule } from '@nestjs/testing';
import {
  afterEach,
  describe,
  expect,
  it,
  beforeEach,
  jest,
} from '@jest/globals';
import ExecaManager from 'src/execa-manager.service';
import { Manager, CommandStatus } from 'src/interfaces/command.interface';
import { CommandRefused, ExecuteCommandDto } from 'src/dto/command.dto';
import { RunOutcome } from 'src/interfaces/runner.interface';
import Queue from 'src/queue.service';
import Config from 'src/config/configuration.service';
import Keyv from 'keyv';
import {
  configFilename,
  nonExistingCommand,
  permittedCommand,
} from 'test/utils';

// Each test runs scripts, and PowerShell takes a second or more to start
// on a loaded Windows host
jest.setTimeout(30000);

describe('Check execution manager based on execa library', () => {
  let dt: Manager;
  let config: Config;
  let queue: Queue;
  const CLIOptions: Keyv = new Keyv();

  beforeAll(async () => {
    await CLIOptions.set('configFile', configFilename);
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExecaManager, Queue, Config],
    }).compile();

    dt = module.get<Manager>(ExecaManager);
    config = module.get<Config>(Config);
    queue = module.get<Queue>(Queue);
    config.loadConfig(CLIOptions);
  });

  afterEach(() => queue.close());

  it('Should report the mode of its database', () => {
    expect((dt as ExecaManager).databaseMode()).toBe('memory');
  });

  it('Should create object', async () => {
    try {
      expect(dt).toBeInstanceOf(ExecaManager);
    } catch (error) {
      expect(fail);
    }
  });

  it('Should execute a valid command', async () => {
    let status: RunOutcome = 'failed';
    let logs: Map<string, string> = new Map<string, string>();

    [status, logs] = await dt.newCommand(permittedCommand(config));

    expect(logs.get('stdout')).toEqual(expect.any(String));
    expect(logs.get('stderr')).toEqual('');
    expect(status).toBe('success');
  });

  it('Should not execute an invalid command', async () => {
    await expect(dt.newCommand(nonExistingCommand)).rejects.toEqual(
      new CommandRefused('invalid command'),
    );
    expect(queue.activeCommand()).toMatchObject({
      status: 'invalid',
      finished: true,
    });
  });

  it('Should return correct command execution status if there has been no prior command execution calls', async () => {
    const expStatus = {
      name: 'none',
      status: 'invalid',
      logs: {
        stdout: '',
        stderr: '',
      },
      exitCode: null,
    };

    const commandStatus: CommandStatus = dt.checkStatus();
    expect(commandStatus).toEqual(expStatus);
  });

  it('Should hold correct history of command executions', async () => {
    const pastCommands: Array<ExecuteCommandDto> = [
      {
        name: 'create',
      },
      {
        name: 'non-existing-command',
      },
      {
        name: 'execute',
      },
    ];
    await Promise.allSettled(
      pastCommands.map((command) => dt.newCommand(command.name)),
    );

    const pastCommandsActual = dt.checkHistory();

    expect(pastCommandsActual).toStrictEqual(pastCommands);
  });

  it('Should return correct command execution status for a series of commands', async () => {
    const commands = ['non-existing-command', 'create'];
    const results = await Promise.allSettled(
      commands.map((command) => dt.newCommand(command)),
    );

    expect(results.map(({ status }) => status)).toEqual([
      'rejected',
      'fulfilled',
    ]);
  });

  describe('repeated requests', () => {
    it('Should run a command once for two concurrent requests', async () => {
      const results = await Promise.all([
        dt.newCommand('create'),
        dt.newCommand('create'),
      ]);

      expect(results.map(([status]) => status)).toEqual(['success', 'success']);
      expect(dt.checkHistory()).toStrictEqual([{ name: 'create' }]);
    });

    it('Should not run a command again for a repeated request key', async () => {
      const [, firstLogs] = await dt.newCommand('create', 'key-1');
      const [status, logs] = await dt.newCommand('create', 'key-1');

      expect(status).toBe('success');
      expect(logs.get('stdout')).toEqual(firstLogs.get('stdout'));
      expect(dt.checkHistory()).toStrictEqual([{ name: 'create' }]);
    });

    it('Should refuse a request key of another command', async () => {
      await dt.newCommand('create', 'key-1');

      await expect(dt.newCommand('execute', 'key-1')).rejects.toEqual(
        new CommandRefused('invalid command'),
      );
      expect(dt.checkHistory()).toStrictEqual([{ name: 'create' }]);
    });

    it('Should wait for the run of a repeated request key', async () => {
      const [first, repeat] = await Promise.all([
        dt.newCommand('create', 'key-1'),
        dt.newCommand('create', 'key-1'),
      ]);

      expect(repeat).toEqual(first);
      expect(dt.checkHistory()).toStrictEqual([{ name: 'create' }]);
    });

    it('Should keep the key of a request that joined a running command', async () => {
      await Promise.all([
        dt.newCommand('create'),
        dt.newCommand('create', 'key-2'),
      ]);
      const [status] = await dt.newCommand('create', 'key-2');

      expect(status).toBe('success');
      expect(dt.checkHistory()).toStrictEqual([{ name: 'create' }]);
    });

    it('Should return the stored result of a run that did not finish', async () => {
      queue.enqueue('create', 'key-1');

      const [status, , exitCode] = await dt.newCommand('create', 'key-1');

      expect(status).toBe('failed');
      expect(exitCode).toBeNull();
      expect(dt.checkHistory()).toStrictEqual([{ name: 'create' }]);
    });

    it('Should treat an empty request key as no key', async () => {
      await expect(dt.newCommand(nonExistingCommand, '')).rejects.toEqual(
        new CommandRefused('invalid command'),
      );
      await dt.newCommand('create', '');

      expect(dt.checkHistory()).toStrictEqual([
        { name: nonExistingCommand },
        { name: 'create' },
      ]);
    });

    it('Should run a command again for a new request key', async () => {
      await dt.newCommand('create', 'key-1');
      await dt.newCommand('create', 'key-2');

      expect(dt.checkHistory()).toStrictEqual([
        { name: 'create' },
        { name: 'create' },
      ]);
    });
  });

  it('Should tell whether a command is running', async () => {
    const manager = dt as ExecaManager;
    const run = manager.newCommand('create');

    expect(manager.isRunning('create')).toBe(true);
    expect(manager.isRunning('execute')).toBe(false);
    await run;
    expect(manager.isRunning('create')).toBe(false);
  });

  it('Should let a running command finish before the database closes', async () => {
    const run = dt.newCommand('create');
    await (dt as ExecaManager).onApplicationShutdown();

    expect((await run)[0]).toBe('success');
    expect(() => queue.checkHistory()).toThrow();
  });
});
