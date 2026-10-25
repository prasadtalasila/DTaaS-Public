import { readFileSync, statSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { z } from 'zod';

// Raised by the runner, not by clients, when the script of a state exits
export const COMPLETION_EVENTS = ['$success', '$failure', '$stopped'] as const;

export type CompletionEvent = (typeof COMPLETION_EVENTS)[number];

// The next state of an event, and whether the script of the state that
// the machine leaves is stopped before the next one runs
export type Transition = { state: string; stop: boolean };

// The transition of each event of one state
export type Transitions = ReadonlyMap<string, Transition>;

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

// A state name, or an object that stops the script first
const targetSchema = z.union(
  [nameSchema, z.object({ state: nameSchema, stop: z.literal(true) }).strict()],
  { error: 'must be a state name, or a state with stop: true' },
);

const stateSchema = z
  .object({
    transitions: z
      .record(z.union([nameSchema, z.enum(COMPLETION_EVENTS)]), targetSchema)
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

const toTransition = (value: z.infer<typeof targetSchema>): Transition =>
  typeof value === 'string' ? { state: value, stop: false } : value;

const toTransitions = (
  transitions?: Record<string, z.infer<typeof targetSchema>> | null,
): Transitions =>
  new Map(
    Object.entries(transitions ?? {}).map(([event, value]) => [
      event,
      toTransition(value),
    ]),
  );

function toDefinition({ events, states }: File): Definition {
  return {
    events: new Set(events),
    states: new Map(
      Object.entries(states).map(([state, value]) => [
        state,
        toTransitions(value?.transitions),
      ]),
    ),
  };
}

const isDeclared = (events: ReadonlySet<string>, event: string): boolean =>
  isCompletion(event) || events.has(event);

function transitionProblems(
  { events, states }: Definition,
  state: string,
  transitions: Transitions,
): string[] {
  const entries = [...transitions];
  const targets = entries
    .filter(([, target]) => !states.has(target.state))
    .map(
      ([, target]) =>
        `state ${state} leads to undeclared state ${target.state}`,
    );
  const undeclared = entries
    .filter(([event]) => !isDeclared(events, event))
    .map(([event]) => `state ${state} uses undeclared event ${event}`);
  // the script has already exited when a completion event is raised
  const stops = entries
    .filter(([event, { stop }]) => stop && isCompletion(event))
    .map(([event]) => `state ${state} can not stop its script on ${event}`);
  return [...targets, ...undeclared, ...stops];
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

// $stopped follows only a stop request from outside, so a loop through
// it can not run by itself
const LOOPING_EVENTS: CompletionEvent[] = ['$success', '$failure'];

const completionTargets = (transitions?: Transitions): string[] =>
  LOOPING_EVENTS.flatMap((event) => transitions?.get(event)?.state ?? []);

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

const invalid = (file: string, problems: string): Error =>
  new Error(`Invalid state machine in ${file}:\n${problems}`);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// The value of a key of a parsed YAML mapping
const field = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

export const hasOwnProto = (value: unknown): boolean =>
  isRecord(value) && Object.hasOwn(value, '__proto__');

// zod skips a __proto__ key of a record without an error, so look for
// one among the states and the events of their transitions
function hasProtoKey(content: unknown): boolean {
  const states = field(content, 'states');
  const transitions = isRecord(states)
    ? Object.values(states).map((state) => field(state, 'transitions'))
    : [];
  return [states, ...transitions].some(hasOwnProto);
}

function readYaml(text: string, file: string): unknown {
  let content: unknown;
  try {
    content = yaml.load(text);
  } catch (error) {
    throw invalid(file, String(error));
  }
  if (hasProtoKey(content)) {
    throw invalid(file, '✖ __proto__ is not a valid name');
  }
  return content;
}

// Throws an error that names the file and every problem of an invalid
// definition
export function parseDefinition(
  text: string,
  permitted: string[],
  file: string,
): Definition {
  const result = fileSchema.safeParse(readYaml(text, file));
  if (!result.success) {
    throw invalid(file, z.prettifyError(result.error));
  }
  const definition = toDefinition(result.data);
  const problems = crossCheck(definition, permitted);
  if (problems.length > 0) {
    throw invalid(file, problems.map((problem) => `✖ ${problem}`).join('\n'));
  }
  return definition;
}

// No file means no state machine; a file that runner.yaml names must
// exist
export function loadDefinition(
  file: string | undefined,
  permitted: string[],
): Definition | undefined {
  if (file === undefined) {
    return undefined;
  }
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(
      `State machine file ${file} does not exist or is not a file`,
    );
  }
  return parseDefinition(readFileSync(file, 'utf8'), permitted, file);
}
