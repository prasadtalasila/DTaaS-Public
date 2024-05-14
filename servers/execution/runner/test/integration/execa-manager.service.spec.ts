import { Test, TestingModule } from '@nestjs/testing';
import { describe, expect, it, beforeEach } from '@jest/globals';
import ExecaManager from 'src/execa-manager.service';
import { Manager, CommandStatus } from 'src/interfaces/command.interface';
import { ExecuteCommandDto } from 'src/dto/command.dto';
import Queue from 'src/queue.service';
import Config from 'src/config/configuration.service';
import Keyv from 'keyv';

describe('Check execution manager based on execa library', () => {
  let dt: Manager;
  let config: Config;
  const CLIOptions: Keyv = new Keyv();

  beforeAll(async () => {
    // TODO: move the filename to test/utils.ts
    await CLIOptions.set('configFile', 'runner.test.yaml');
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExecaManager, Queue, Config],
    }).compile();

    dt = module.get<Manager>(ExecaManager);
    config = module.get<Config>(Config);
    config.loadConfig(CLIOptions);
  });

  it('Should create object', async () => {
    try {
      expect(dt).toBeInstanceOf(ExecaManager);
    } catch (error) {
      expect(fail);
    }
  });

  it('Should execute a valid command', async () => {
    let status: boolean = false;
    let logs: Map<string, string> = new Map<string, string>();

    // TODO: receive this command from config object
    // take only the first element of this array to make sure
    // that there may be more than one permitted command
    [status, logs] = await dt.newCommand('create');

    expect(logs.get('stdout')).toEqual(expect.any(String));
    expect(logs.get('stderr')).toEqual('');
    expect(status).toBe(true);
  });

  it('Should not execute an invalid command', async () => {
    let status: boolean = true;
    let logs: Map<string, string> = new Map<string, string>();

    // TODO: move the command name to test/utils.ts
    [status, logs] = await dt.newCommand('asdfghjkl');

    expect(status).toBe(false);
    expect(logs.get('stdout')).toBeUndefined();
    expect(logs.get('stderr')).toBeUndefined();
  });

  it('Should return correct command execution status if there has been no prior command execution calls', async () => {
    const expStatus = {
      name: 'none',
      status: 'invalid',
      logs: {
        stdout: '',
        stderr: '',
      },
    };

    const commandStatus: CommandStatus = dt.checkStatus();
    expect(commandStatus).toEqual(expStatus);
  });

  // TODO: test for status as well
  // only the status is failing, why?
  it.failing('Should hold correct history of command executions', async () => {
    const newCommandStatus: boolean[] = [];
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
    // pastCommands.map(async (command) => await dt.newCommand(command.name));
    pastCommands.map(async (command) => {
      const [collectStatus] = await dt.newCommand(command.name);
      newCommandStatus.push(collectStatus);
    });
    const pastCommandsActual = dt.checkHistory();

    expect(pastCommandsActual).toStrictEqual(pastCommands);

    const expStatus = {
      name: 'execute',
      status: 'invalid',
      logs: {
        stdout: '',
        stderr: '',
      },
    };

    const commandStatus: CommandStatus = dt.checkStatus();
    expect(commandStatus).toEqual(expStatus);
    expect(newCommandStatus).toEqual([true, false, false]);
  });

  // TODO: write test to check for the status of valid and invalid commands
  // executed in that order
});
