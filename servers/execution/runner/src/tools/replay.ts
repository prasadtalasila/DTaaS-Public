#!/usr/bin/env node

import { Command } from 'commander';
import { runnerVersion } from '../snapshot/snapshot.js';
import { replay } from './replay-run.js';
import { runTool } from './tool-error.js';

const program = new Command('runner-replay')
  .description('Replay a twin from a snapshot, as a replay file describes')
  .argument('[file]', 'the replay file', 'runner-replay.yaml')
  .option('--dry-run', 'print the inputs and their times, and start nothing')
  .version(runnerVersion())
  .exitOverride((error) => process.exit(error.exitCode === 0 ? 0 : 2))
  .parse();

await runTool(() =>
  replay(program.processedArgs[0], program.opts().dryRun === true),
);
