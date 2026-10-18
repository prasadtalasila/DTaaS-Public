import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { z } from 'zod';

export const DEFINITION_FILE = 'state-machine.yaml';

// Raised by the runner, not by clients, when the script of a state exits
export const COMPLETION_EVENTS = ['$success', '$failure'] as const;

export type CompletionEvent = (typeof COMPLETION_EVENTS)[number];

// The next state for each event of one state
export type Transitions = ReadonlyMap<string, string>;

export type Definition = {
  events: ReadonlySet<string>;
  states: ReadonlyMap<string, Transitions>;
};

// A state names a script, so a name can not be a path, a flag or an
// object property such as __proto__
const NAME = /^[A-Za-z0-9][\w.-]{0,63}$/;

export const nameSchema = z
  .string()
  .regex(NAME, 'must be up to 64 letters, digits, _, . or -, from a letter');

const stateSchema = z
  .object({
    transitions: z
      .record(z.union([nameSchema, z.enum(COMPLETION_EVENTS)]), nameSchema)
      .nullish(),
  })
  .strict()
  .nullish();

const fileSchema = z
  .object({
    events: z.array(nameSchema).default([]),
    states: z
      .record(nameSchema, stateSchema)
      .refine((states) => Object.keys(states).length > 0, {
        message: 'must have at least one state',
      }),
  })
  .strict();

type File = z.infer<typeof fileSchema>;

const isCompletion = (event: string): boolean =>
  (COMPLETION_EVENTS as readonly string[]).includes(event);

function toDefinition({ events, states }: File): Definition {
  return {
    events: new Set(events),
    states: new Map(
      Object.entries(states).map(([state, value]) => [
        state,
        new Map(Object.entries(value?.transitions ?? {})),
      ]),
    ),
  };
}

function transitionProblems(
  { events, states }: Definition,
  state: string,
  transitions: Transitions,
): string[] {
  const problems: string[] = [];
  transitions.forEach((target, event) => {
    if (!states.has(target)) {
      problems.push(`state ${state} leads to undeclared state ${target}`);
    }
    if (!isCompletion(event) && !events.has(event)) {
      problems.push(`state ${state} uses undeclared event ${event}`);
    }
  });
  return problems;
}

// The problems of the states and transitions of a definition
function crossCheck(definition: Definition, permitted: string[]): string[] {
  const problems: string[] = [];
  definition.states.forEach((transitions, state) => {
    if (!permitted.includes(state)) {
      problems.push(`state ${state} is not a permitted command`);
    }
    problems.push(...transitionProblems(definition, state, transitions));
  });
  const cycle = completionCycle(definition);
  if (cycle !== undefined) {
    problems.push(`completion events loop forever: ${cycle.join(' -> ')}`);
  }
  return problems;
}

const completionTargets = (transitions?: Transitions): string[] =>
  COMPLETION_EVENTS.flatMap((event) => transitions?.get(event) ?? []);

// Depth-first search from the last state of the path; a cycle is a
// path that reaches a state already on it. The done states have been
// searched, so they lead to no cycle that is not found already.
function findCycle(
  states: Definition['states'],
  path: string[],
  done: Set<string>,
): string[] | undefined {
  const state = path.at(-1) as string;
  const start = path.indexOf(state);
  if (start < path.length - 1) {
    return path.slice(start);
  }
  if (done.has(state)) {
    return undefined;
  }
  done.add(state);
  return completionTargets(states.get(state))
    .map((target) => findCycle(states, [...path, target], done))
    .find(Boolean);
}

// A loop of completion transitions, which would run scripts forever
function completionCycle({ states }: Definition): string[] | undefined {
  const done = new Set<string>();
  return [...states.keys()]
    .map((state) => findCycle(states, [state], done))
    .find(Boolean);
}

const invalid = (problems: string): Error =>
  new Error(`Invalid state machine in ${DEFINITION_FILE}:\n${problems}`);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// zod skips a __proto__ key of a record without an error, so look for
// one among the states and the events of their transitions
function hasProtoKey(content: unknown): boolean {
  const states = isRecord(content) ? content.states : undefined;
  if (!isRecord(states)) {
    return false;
  }
  const transitions = Object.values(states).map((state) =>
    isRecord(state) ? state.transitions : undefined,
  );
  return [states, ...transitions].some(
    (record) => isRecord(record) && Object.hasOwn(record, '__proto__'),
  );
}

function readYaml(text: string): unknown {
  let content: unknown;
  try {
    content = yaml.load(text);
  } catch (error) {
    throw invalid(String(error));
  }
  if (hasProtoKey(content)) {
    throw invalid('✖ __proto__ is not a valid name');
  }
  return content;
}

// Throws an error that names every problem of an invalid definition
export function parseDefinition(text: string, permitted: string[]): Definition {
  const result = fileSchema.safeParse(readYaml(text));
  if (!result.success) {
    throw invalid(z.prettifyError(result.error));
  }
  const definition = toDefinition(result.data);
  const problems = crossCheck(definition, permitted);
  if (problems.length > 0) {
    throw invalid(problems.map((problem) => `✖ ${problem}`).join('\n'));
  }
  return definition;
}

export function loadDefinition(
  location: string,
  permitted: string[],
): Definition | undefined {
  const file = join(location, DEFINITION_FILE);
  if (!existsSync(file)) {
    return undefined;
  }
  return parseDefinition(readFileSync(file, 'utf8'), permitted);
}
