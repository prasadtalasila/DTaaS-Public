import { Command } from 'commander';
import { readFileSync } from 'fs';
//import chalk from 'chalk';
import Keyv from 'keyv';
import resolveFile from './util.js';

const DEFAULT_CONFIG_FILENAME = 'runner.yaml';

export function createCommand(name: string): [Command, Keyv] {
  return [new Command(name), new Keyv()];
}

export default async function CLI(
  program: Command,
  CLIOptions: Keyv,
): Promise<Keyv> {
  program
    .description('Remote code execution for humans')
    .option(
      '-c --config <string>',
      'runner config file specified in yaml format',
      DEFAULT_CONFIG_FILENAME,
    )
    .option(
      '--reinstate <directory>',
      'start the twin from the snapshot in the directory',
    )
    .helpOption('-h --help', 'display help')
    .showHelpAfterError()
    .helpInformation();

  program.parse(process.argv);
  const options = program.opts();

  if (options.config !== undefined) {
    const configFile: string = options.config;
    const resolvedFilename: string = resolveFile(configFile.toString());
    try {
      readFileSync(resolvedFilename, 'utf8');
    } catch (err) {
      throw new Error('Invalid configuration', { cause: err });
    }
    await CLIOptions.set('configFile', resolvedFilename);
  }
  if (options.reinstate !== undefined) {
    await CLIOptions.set('reinstate', resolveFile(options.reinstate));
  }
  return CLIOptions;
}
