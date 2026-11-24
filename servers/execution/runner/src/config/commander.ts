import { Command, OptionValues } from 'commander';
import { readFileSync } from 'fs';
//import chalk from 'chalk';
import Keyv from 'keyv';
import resolveFile from './util.js';

const DEFAULT_CONFIG_FILENAME = 'runner.yaml';

// The time scale of a replay twin, undefined for any other runner;
// throws at each misuse of --what-if and --time-scale
export function replayScale({
  whatIf,
  reinstate,
  timeScale,
}: OptionValues): number | undefined {
  if (whatIf !== true) {
    if (timeScale !== undefined) {
      throw new Error('--time-scale is accepted only with --what-if');
    }
    return undefined;
  }
  if (reinstate === undefined) {
    throw new Error('--what-if is accepted only with --reinstate');
  }
  return scaleOf(timeScale ?? '1');
}

// Number('') and Number(' ') are 0, which is refused as well
function scaleOf(given: string): number {
  const scale = Number(given);
  if (!(scale > 0 && Number.isFinite(scale))) {
    throw new Error(`--time-scale takes a number above 0, not ${given}`);
  }
  return scale;
}

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
    .option(
      '--what-if',
      'start a replay twin, which reaches nobody; only with --reinstate',
    )
    .option(
      '--time-scale <factor>',
      'how fast the time of a replay twin runs; only with --what-if',
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
  const scale = replayScale(options);
  if (scale !== undefined) {
    await CLIOptions.set('replay', scale);
  }
  return CLIOptions;
}
