import { z } from 'zod';
import type { Definition } from './definition.js';
import { refusedName } from '../scripts/launch.js';
import { variableName } from './parameters.js';

// The variables of a script's environment, by name
export type Env = Readonly<Record<string, string>>;

// A declared name is upper case and leaves the runner's prefixes alone
const VARIABLE = /^[A-Z][A-Z0-9_]*$/;

const RESERVED = /^(DT|RUNNER)_/;

// A reference to a runner variable in a declared value
export const REFERENCE = /\$\{([^}]*)\}/g;

// Why a declared name is refused, if it is; zod reports a refused
// record key only as an invalid key, so the names are checked apart
function nameProblem(name: string): string | undefined {
  if (!VARIABLE.test(name)) {
    return 'must be upper-case letters, digits or _, from a letter';
  }
  return RESERVED.test(name) ? 'must not start with DT_ or RUNNER_' : undefined;
}

// The env of the state machine file and of a state; values become
// strings
export const envSchema = z
  .record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()]).transform(String),
  )
  .superRefine((env, context) => {
    Object.keys(env).forEach((name) => {
      const message = nameProblem(name);
      if (message !== undefined) {
        context.addIssue({ code: 'custom', message, path: [name] });
      }
    });
  })
  .default({});

// The runner variables that a declared value may interpolate, besides
// the parameter variables
export const RUNNER_VARIABLES = [
  'RUNNER_URL',
  'RUNNER_TOKEN',
  'DT_ID',
  'DT_STATE',
  'DT_ENTRY',
];

export const knownNames = ({ parameters }: Definition): Set<string> =>
  new Set([...RUNNER_VARIABLES, ...[...parameters.keys()].map(variableName)]);

const references = (value: string): string[] =>
  [...value.matchAll(REFERENCE)].map(([, name]) => name);

// One problem for each unknown name that a value of the env refers to
const unknownNames = (env: Env, known: Set<string>, owner: string) =>
  Object.entries(env).flatMap(([name, value]) =>
    references(value)
      .filter((reference) => !known.has(reference))
      .map((reference) => `${owner}${name} uses unknown variable ${reference}`),
  );

// With a script account, setpriv starts with capabilities but not in
// secure-execution mode, so its loader would honour these names
const refusedNames = (env: Env, owner: string) =>
  Object.keys(env)
    .filter(refusedName)
    .map((name) => `${owner}${name} is refused with scripts.user`);

// The problems of the env of a definition that its schema can not see,
// and with a script account the names that the launch refuses
export function envProblems(
  definition: Definition,
  separated = false,
): string[] {
  const known = knownNames(definition);
  const envs: Array<[Env, string]> = [
    [definition.env, 'env '],
    ...[...definition.stateEnv].map(([state, env]): [Env, string] => [
      env,
      `state ${state} env `,
    ]),
  ];
  const unknown = envs.flatMap(([env, owner]) =>
    unknownNames(env, known, owner),
  );
  const refused = envs.flatMap(([env, owner]) => refusedNames(env, owner));
  return [...unknown, ...(separated ? refused : [])];
}
