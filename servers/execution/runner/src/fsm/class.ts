import { z } from 'zod';
import type { ParameterValue } from '../dto/parameters.dto.js';
import type { Definition } from './definition.js';
import { Declarations, valueProblems } from './parameters.js';
import { bind, Bound } from './subscriptions.js';

// A word without spaces, such as a URN or a version number
const word = (longest: number) =>
  z
    .string()
    .regex(
      new RegExp(`^\\S{1,${longest}}$`),
      `must be up to ${longest} characters, without spaces`,
    );

// The class of the digital twins that share a state machine file: the
// kind of twin that the file defines. The runner shows the id and the
// version, and never reads them.
export const classSchema = z
  .strictObject({ id: word(200), version: word(64) })
  .optional();

export type DtClass = NonNullable<z.infer<typeof classSchema>>;

// The scripts that save and restore what the scripts of the class keep
// for themselves, each a command of runner.yaml
export const snapshotScriptsSchema = z
  .strictObject({
    save: z.string().min(1).optional(),
    restore: z.string().min(1).optional(),
  })
  .default({});

export type SnapshotScripts = z.infer<typeof snapshotScriptsSchema>;

// The snapshot scripts that runner.yaml does not permit
export const snapshotProblems = (
  scripts: SnapshotScripts,
  permitted: string[],
): string[] =>
  Object.entries(scripts)
    .filter(([, command]) => !permitted.includes(command))
    .map(
      ([kind, command]) =>
        `snapshot ${kind} script ${command} is not a permitted command`,
    );

// The commands that POST /whatif runs on a private copy of the twin,
// and whether the class allows a replay twin, which runs its scripts
export const whatIfSchema = z
  .strictObject({
    commands: z.array(z.string().min(1)).default([]),
    replay: z.boolean().optional(),
  })
  .optional();

export type WhatIf = NonNullable<z.infer<typeof whatIfSchema>>;

// A what-if command is a script written for the purpose, while the
// script of a state runs for the machine, so neither may be the other
const stateProblems = (
  commands: string[],
  states: ReadonlyMap<string, unknown>,
) =>
  commands
    .filter((command) => states.has(command))
    .map(
      (command) =>
        `what-if command ${command} is the script of a state, which runs for the machine; a what-if needs a script of its own`,
    );

// The what-if commands that runner.yaml does not permit or that are
// states, and a what-if command without the save script that makes its
// copy; a replay twin alone needs no save script
export function whatIfProblems(
  { whatIf, snapshot: { save }, states }: Definition,
  permitted: string[],
): string[] {
  if (whatIf === undefined) {
    return [];
  }
  const problems = [
    ...whatIf.commands
      .filter((command) => !permitted.includes(command))
      .map(
        (command) => `what-if command ${command} is not a permitted command`,
      ),
    ...stateProblems(whatIf.commands, states),
  ];
  return save === undefined && whatIf.commands.length > 0
    ? [...problems, 'whatIf needs snapshot.save, which makes its copy']
    : problems;
}

// The values that runner.yaml gives the parameters of one instance of
// the class, in place of the defaults of the file
export type InstanceValues = Record<string, ParameterValue>;

function instanceProblems(
  parameters: Declarations,
  [name, value]: [string, ParameterValue],
): string[] {
  const declaration = parameters.get(name);
  return declaration === undefined
    ? [`parameter ${name} is not declared`]
    : valueProblems(`parameter ${name}`, declaration, value);
}

// What runner.yaml sets for one instance of a class
export type Instance = { parameters?: InstanceValues; relationships?: Bound };

// The definition of one instance: each parameter that runner.yaml sets
// takes that value as its default, and each subscription to a
// relationship follows the peers that runner.yaml gives it. Throws an
// error that names every value that is not declared or does not fit
// its declaration.
export function instantiate(
  definition: Definition,
  { parameters: values = {}, relationships = {} }: Instance,
  file: string,
): Definition {
  const entries = Object.entries(values);
  const problems = entries.flatMap((entry) =>
    instanceProblems(definition.parameters, entry),
  );
  if (problems.length > 0) {
    const list = problems.map((problem) => `✖ ${problem}`).join('\n');
    throw new Error(`Invalid parameters in runner.yaml for ${file}:\n${list}`);
  }
  const parameters = new Map(
    [...definition.parameters].map(([name, declaration]) => [
      name,
      Object.hasOwn(values, name)
        ? { ...declaration, default: values[name] }
        : declaration,
    ]),
  );
  const subscriptions = bind(definition.subscriptions, relationships);
  return { ...definition, parameters, subscriptions };
}
