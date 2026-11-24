import { z } from 'zod';
import {
  ParameterDto,
  ParametersBody,
  ParametersDto,
  ParameterValue,
} from '../dto/parameters.dto.js';
import { nameSchema, reservedProblems } from './name.js';
import { field, isRecord } from './proto.js';
import {
  scalarKeywords,
  SCALAR_TYPES,
  schemaProblems,
  validator,
  valueProblems as fitProblems,
} from './value-schema.js';

// zod names the invalid type only, so say what replaced type enum
export const oldEnumHints = (section: unknown): string[] =>
  Object.entries(isRecord(section) ? section : {})
    .filter(([, value]) => field(value, 'type') === 'enum')
    .map(
      ([name]) =>
        `✖ parameter ${name}: write type string with enum, as 0.12.0 removed type enum`,
    );

const isSet = (value: unknown): boolean =>
  value !== undefined && value !== null;

// A scalar of JSON Schema, without a unit: a parameter is a setting of
// a policy, not a measurement
const parameterSchema = z.strictObject({
  type: z.enum(SCALAR_TYPES),
  ...scalarKeywords,
  // checked against the declaration, which names what it expects
  default: z.custom<ParameterValue>(isSet, 'needs a default'),
  controllable: z.boolean().default(false),
  event: nameSchema.optional(),
});

export const parametersSchema = z
  .record(nameSchema, parameterSchema)
  .default({});

export type Declaration = z.infer<typeof parameterSchema>;

export type Declarations = ReadonlyMap<string, Declaration>;

// The environment variable that passes the value of a parameter to the
// scripts
export const variableName = (name: string): string =>
  `DT_PARAM_${name.toUpperCase().replaceAll(/[.-]/g, '_')}`;

// Why the value does not fit the declaration, after the subject
export const valueProblems = (
  subject: string,
  declaration: Declaration,
  value: unknown,
): string[] => fitProblems(subject, validator(declaration), value);

// The names that share the variable name of an earlier name
function collisions(names: string[]): string[] {
  const owners = new Map<string, string>();
  return names.flatMap((name) => {
    const variable = variableName(name);
    const owner = owners.get(variable) ?? name;
    owners.set(variable, owner);
    return owner === name
      ? []
      : [`parameters ${owner} and ${name} share the variable ${variable}`];
  });
}

type Section = { events: ReadonlySet<string>; parameters: Declarations };

// The problems of the parameters of a definition that their schema can
// not see
export function parameterProblems({ events, parameters }: Section): string[] {
  const entries = [...parameters];
  const declared = entries.flatMap(([name, declaration]) =>
    schemaProblems(`parameter ${name}`, declaration, { units: false }),
  );
  // a default is checked against a sound declaration only
  const defaults = entries.flatMap(([name, declaration]) =>
    valueProblems(
      `parameter ${name} default`,
      declaration,
      declaration.default,
    ),
  );
  const undeclared = entries
    .filter(([, { event }]) => event !== undefined && !events.has(event))
    .map(
      ([name, { event }]) =>
        `parameter ${name} raises undeclared event ${event}`,
    );
  return [
    ...(declared.length > 0 ? declared : defaults),
    ...undeclared,
    ...reservedProblems('parameter', [...parameters.keys()]),
    ...collisions([...parameters.keys()]),
  ];
}

// A declaration as GET /parameters shows it; the event stays internal
const describe = (declaration: Declaration) =>
  Object.fromEntries(
    Object.entries(declaration).filter(([key]) => key !== 'event'),
  ) as Omit<ParameterDto, 'value'>;

export type ParameterChanges = {
  changes: ReadonlyMap<string, ParameterValue>;
  events: string[];
};

export type ParameterCheck = { problems: string[] } | ParameterChanges;

// The declared parameters of a digital twin and their current values,
// which start at their defaults
export default class Parameters {
  private readonly current: Record<string, ParameterValue>;

  constructor(private readonly declarations: Declarations) {
    this.current = Object.fromEntries(
      [...declarations].map(([name, declaration]) => [
        name,
        declaration.default,
      ]),
    );
  }

  values(): Record<string, ParameterValue> {
    return { ...this.current };
  }

  // The value and the declaration of each parameter, without its event
  document(): ParametersDto {
    return Object.fromEntries(
      [...this.declarations].map(([name, declaration]) => [
        name,
        { value: this.current[name], ...describe(declaration) },
      ]),
    );
  }

  // Validates a body without applying it: the problems of all its
  // entries, or else the values that change and the events that they
  // raise, once each in the order of the declarations
  check(body: ParametersBody): ParameterCheck {
    const entries = Object.entries(body);
    const problems = entries.flatMap(([name, value]) =>
      this.problems(name, value),
    );
    if (problems.length > 0) {
      return { problems };
    }
    const changes = new Map(
      entries.filter(([name, value]) => this.current[name] !== value),
    );
    return { changes, events: this.events(changes) };
  }

  // Applies the whole body or none of it: the changes are stored before
  // they are committed, so that a failing store changes neither. The
  // events of the changes are the caller's to raise.
  apply(
    body: ParametersBody,
    store: (changes: ReadonlyMap<string, ParameterValue>) => void,
  ): { problems: string[]; events: string[] } {
    const result = this.check(body);
    if ('problems' in result) {
      return { problems: result.problems, events: [] };
    }
    store(result.changes);
    this.commit(result.changes);
    return { problems: [], events: result.events };
  }

  commit(changes: ReadonlyMap<string, ParameterValue>): void {
    changes.forEach((value, name) => {
      this.current[name] = value;
    });
  }

  // Takes the stored values of controllable parameters that fit their
  // declarations, and returns the names of the others, which keep their
  // defaults
  restore(values: Record<string, ParameterValue>): string[] {
    const entries = Object.entries(values);
    const fits = ([name, value]: [string, ParameterValue]) =>
      this.fits(name, value);
    this.commit(new Map(entries.filter(fits)));
    return entries.filter((entry) => !fits(entry)).map(([name]) => name);
  }

  private fits(name: string, value: ParameterValue): boolean {
    const declaration = this.declarations.get(name);
    return (
      declaration?.controllable === true &&
      valueProblems(name, declaration, value).length === 0
    );
  }

  private problems(name: string, value: ParameterValue): string[] {
    const declaration = this.declarations.get(name);
    if (declaration === undefined) {
      return [`parameter ${name} is not declared`];
    }
    if (!declaration.controllable) {
      return [`parameter ${name} is not controllable`];
    }
    return valueProblems(`parameter ${name}`, declaration, value);
  }

  private events(changes: ReadonlyMap<string, ParameterValue>): string[] {
    const events = [...this.declarations]
      .filter(([name]) => changes.has(name))
      .flatMap(([, { event }]) => event ?? []);
    return [...new Set(events)];
  }
}
