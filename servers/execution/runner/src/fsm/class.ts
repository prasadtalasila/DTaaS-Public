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
