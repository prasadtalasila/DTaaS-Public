import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { z } from 'zod';

// The state machine of a digital twin, in the folder of its scripts
export const DEFINITION_FILE = 'state-machine.yaml';

// The events that the runner raises when the script of a state exits
export const COMPLETION_EVENTS = ['$success', '$failure'] as const;

export type CompletionEvent = (typeof COMPLETION_EVENTS)[number];

// The next state for each event, by state
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
    on: z
      .record(z.union([nameSchema, z.enum(COMPLETION_EVENTS)]), nameSchema)
      .default({}),
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
        new Map(Object.entries(value?.on ?? {})),
      ]),
    ),
  };
}

// The problems of the states and transitions of a definition
function crossCheck(definition: Definition, permitted: string[]): string[] {
  const problems: string[] = [];
  definition.states.forEach((transitions, state) => {
    if (!permitted.includes(state)) {
      problems.push(`state ${state} is not a permitted command`);
    }
    transitions.forEach((target, event) => {
      if (!definition.states.has(target)) {
        problems.push(`state ${state} leads to undeclared state ${target}`);
      }
      if (!isCompletion(event) && !definition.events.has(event)) {
        problems.push(`state ${state} uses undeclared event ${event}`);
      }
    });
  });
  const cycle = completionCycle(definition);
  if (cycle !== undefined) {
    problems.push(`completion events loop forever: ${cycle.join(' -> ')}`);
  }
  return problems;
}

// A path of completion transitions that returns to its first state
function completionCycle({ states }: Definition): string[] | undefined {
  const done = new Set<string>();
  const visit = (path: string[]): string[] | undefined => {
    const state = path[path.length - 1];
    const start = path.indexOf(state);
    if (start < path.length - 1) {
      return path.slice(start);
    }
    if (done.has(state)) {
      return undefined;
    }
    done.add(state);
    const targets = COMPLETION_EVENTS.map((event) =>
      states.get(state)?.get(event),
    );
    for (const target of targets) {
      const cycle = target && visit([...path, target]);
      if (cycle) {
        return cycle;
      }
    }
    return undefined;
  };
  return [...states.keys()].map((state) => visit([state])).find(Boolean);
}

const invalid = (problems: string): Error =>
  new Error(`Invalid state machine in ${DEFINITION_FILE}:\n${problems}`);

// Throws an error that names every problem of an invalid definition
export function parseDefinition(text: string, permitted: string[]): Definition {
  let content: unknown;
  try {
    content = yaml.load(text);
  } catch (error) {
    throw invalid(String(error));
  }
  const result = fileSchema.safeParse(content);
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

// The state machine of the script folder, if it has one
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
