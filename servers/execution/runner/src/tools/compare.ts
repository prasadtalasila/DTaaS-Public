#!/usr/bin/env node

import { Command } from 'commander';
import { runnerVersion } from '../snapshot/snapshot.js';
import { compare } from './compare-run.js';
import { runTool } from './tool-error.js';

const program = new Command('runner-compare')
  .description('List the state entries of two timelines side by side')
  .argument('<a>', 'a snapshot, or the out of a replay')
  .argument('<b>', 'a snapshot, or the out of a replay')
  .option('--json', 'print the comparison as one JSON document')
  .version(runnerVersion())
  .exitOverride((error) => process.exit(error.exitCode === 0 ? 0 : 2))
  .parse();

const [a, b] = program.processedArgs as [string, string];
await runTool(async () => compare(a, b, program.opts().json === true));
