// Reads runner.yaml and checks it against the schema

import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { ConfigValues } from './config.interface.js';
import { configSchema } from './config.schema.js';
import { hasOwnProto } from '../fsm/definition.js';

export const invalid = (file: string, problems: string): Error =>
  new Error(`Invalid configuration in ${file}:\n${problems}`);

// js-yaml throws on an empty file and on a syntax error, neither of
// which names the file
export function readConfig(file: string): unknown {
  try {
    return yaml.load(readFileSync(file, 'utf8'));
  } catch (error) {
    throw invalid(file, String(error));
  }
}

// The value of a key of a parsed YAML mapping
const field = (value: unknown, key: string): unknown =>
  (value as Record<string, unknown> | null | undefined)?.[key];

// zod skips a __proto__ key of a record without an error, so look for
// one among the attributes of the runner and of each peer first
function protoProblem(content: unknown): string | undefined {
  const peers = field(field(content, 'relationships'), 'peers');
  const attributes = [
    ['attributes', field(content, 'attributes')],
    ...(Array.isArray(peers) ? peers : []).map((peer, index) => [
      `relationships.peers.${index}.attributes`,
      field(peer, 'attributes'),
    ]),
  ];
  const found = attributes.find(([, value]) => hasOwnProto(value));
  return found && `✖ __proto__ is not a valid name\n  → at ${found[0]}`;
}

// The keys that moved under relationships in 0.11; 0.12 refuses them
const MOVED: Readonly<Record<string, string>> = {
  notify: 'relationships.manager.notify',
  peers: 'relationships.peers',
};

// zod names an unknown key only, so say where each old key moved
const movedKeys = (error: z.ZodError): string[] =>
  error.issues
    .flatMap((issue) =>
      issue.code === 'unrecognized_keys' && issue.path.length === 0
        ? issue.keys
        : [],
    )
    .filter((key) => Object.hasOwn(MOVED, key))
    .map((key) => `✖ ${key} moved to ${MOVED[key]} in 0.11`);

export function parseConfig(content: unknown, file: string): ConfigValues {
  const problem = protoProblem(content);
  if (problem !== undefined) {
    throw invalid(file, problem);
  }
  const result = configSchema.safeParse(content);
  if (!result.success) {
    const problems = [
      z.prettifyError(result.error),
      ...movedKeys(result.error),
    ];
    throw invalid(file, problems.join('\n'));
  }
  return result.data;
}
