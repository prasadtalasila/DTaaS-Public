import { resolve } from 'node:path';
import { jest } from '@jest/globals';
import CLI, { createCommand } from 'src/config/commander';

describe('Commander functionality', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Should invoke commander correctly', async () => {
    const [program, CLIOptionsExp] = createCommand('runner');
    const argvCall = jest.spyOn(program, 'parse');

    try {
      await CLI(program, CLIOptionsExp);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(argvCall).toHaveBeenCalled();
      expect(program.opts()).toEqual({
        config: 'runner.yaml',
      });
    }
  });

  it('Should run without any flags', async () => {
    const [program, CLIOptionsExp] = createCommand('runner');
    try {
      await CLI(program, CLIOptionsExp);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('Should process config correctly', async () => {
    const [program, CLIOptionsExp] = createCommand('runner');
    jest.replaceProperty(process, 'argv', [
      'node',
      'main.js',
      '--config',
      'runner.test.yaml',
    ]);
    await CLI(program, CLIOptionsExp);

    expect(program.opts()).toEqual({
      config: 'runner.test.yaml',
    });
  });

  it('Should keep the snapshot directory of --reinstate, resolved', async () => {
    const [program, CLIOptionsExp] = createCommand('runner');
    jest.replaceProperty(process, 'argv', [
      'node',
      'main.js',
      '--config',
      'runner.test.yaml',
      '--reinstate',
      'snapshots/20261123T101502120Z',
    ]);
    await CLI(program, CLIOptionsExp);

    expect(await CLIOptionsExp.get('reinstate')).toBe(
      resolve('snapshots/20261123T101502120Z'),
    );
  });

  it('Should throw exception of the config file is not found', async () => {
    const [program, CLIOptionsExp] = createCommand('runner');
    jest.replaceProperty(process, 'argv', [
      'node',
      'main.js',
      '--config',
      'runner.test.yaml.nonexistent',
    ]);
    const callCLI = async () => {
      await CLI(program, CLIOptionsExp);
    };
    await expect(callCLI()).rejects.toThrow(Error);
  });
});
