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

  describe('A replay twin', () => {
    // The options that the arguments after the config file leave, or the
    // message of the error that stops the start
    async function parse(...args: string[]): Promise<unknown> {
      const [program, options] = createCommand('runner');
      jest.replaceProperty(process, 'argv', [
        'node',
        'main.js',
        '--config',
        'runner.test.yaml',
        ...args,
      ]);
      return CLI(program, options).then(
        async () => options.get('replay'),
        (error: Error) => error.message,
      );
    }

    const SNAPSHOT = ['--reinstate', 'snapshots/20261123T101502120Z'];

    it('Should be no replay twin without --what-if', async () => {
      expect(await parse(...SNAPSHOT)).toBeUndefined();
    });

    it('Should run at the speed of the clock by default', async () => {
      expect(await parse(...SNAPSHOT, '--what-if')).toBe(1);
    });

    it('Should keep the factor of --time-scale', async () => {
      expect(await parse(...SNAPSHOT, '--what-if', '--time-scale', '60')).toBe(
        60,
      );
    });

    it('Should refuse --what-if without --reinstate', async () => {
      expect(await parse('--what-if')).toBe(
        '--what-if is accepted only with --reinstate',
      );
    });

    it('Should refuse --time-scale without --what-if', async () => {
      expect(await parse(...SNAPSHOT, '--time-scale', '2')).toBe(
        '--time-scale is accepted only with --what-if',
      );
      expect(await parse('--time-scale', '2')).toBe(
        '--time-scale is accepted only with --what-if',
      );
    });

    it.each(['0', '-1', 'fast', ' ', 'Infinity'])(
      'Should refuse the factor %j',
      async (factor) => {
        expect(
          await parse(...SNAPSHOT, '--what-if', `--time-scale=${factor}`),
        ).toBe(`--time-scale takes a number above 0, not ${factor}`);
      },
    );
  });
});
