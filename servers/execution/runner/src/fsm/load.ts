import { readFileSync, statSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import type Config from '../config/configuration.service.js';
import { instantiate } from './class.js';
import { Definition, parseDefinition } from './definition.js';
import { Known, known, unbound } from './subscriptions.js';

const logger = new Logger('StateMachineFile');

// Without a state machine file, runner.yaml can set no parameter
function refuseParameters({ parameters = {} }: Known): void {
  if (Object.keys(parameters).length > 0) {
    throw new Error('The parameters of runner.yaml need a stateMachine file');
  }
}

// A relationship that no peer has is no error: another instance of the
// class may have such a peer
function logUnbound(definition: Definition, known: Known, file: string): void {
  const idle = unbound(definition.subscriptions, known.relationships ?? {});
  if (idle.length > 0) {
    logger.log(
      `${file}: no peer of runner.yaml has the relationship ${idle.join(', ')}, so its subscriptions are idle`,
    );
  }
}

// The state machine file as one instance of its class runs it: with
// the parameter values and the peers of runner.yaml. No file means no
// state machine; a file that runner.yaml names must exist.
export function loadDefinition(
  file: string | undefined,
  known: Known,
): Definition | undefined {
  if (file === undefined) {
    refuseParameters(known);
    return undefined;
  }
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(
      `State machine file ${file} does not exist or is not a file`,
    );
  }
  const definition = parseDefinition(readFileSync(file, 'utf8'), file, known);
  logUnbound(definition, known, file);
  return instantiate(definition, known, file);
}

// The state machine file that the configuration names, as its instance
export const loadConfigured = (config: Config): Definition | undefined =>
  loadDefinition(config.getStateMachine(), known(config));
