import * as yaml from 'js-yaml';
import { z } from 'zod';
import {
  classSchema,
  DtClass,
  SnapshotScripts,
  snapshotProblems,
  snapshotScriptsSchema,
  WhatIf,
  whatIfProblems,
  whatIfSchema,
} from './class.js';
import completionCycle from './completion-cycle.js';
import { Escalation, escalationSchema } from './escalation.js';
import { managerProblems, managerSchema } from './manager.js';
import { nameSchema } from './name.js';
import {
  Declarations,
  oldEnumHints,
  parameterProblems,
  parametersSchema,
} from './parameters.js';
import {
  PropertyDeclarations,
  propertiesSchema,
  propertyProblems,
} from './properties.js';
import { field, hasProtoKey } from './proto.js';
import { type Env, envProblems, envSchema } from './declared-env.js';
import {
  Known,
  Subscription,
  subscriptionProblems,
  subscriptionsSchema,
} from './subscriptions.js';

export { nameSchema } from './name.js';
export { hasOwnProto } from './proto.js';

// Raised by the runner, not by clients, when the script of a state exits
export const COMPLETION_EVENTS = ['$success', '$failure', '$stopped'] as const;

export type CompletionEvent = (typeof COMPLETION_EVENTS)[number];

// The next state of an event, and whether the script of the state that
// the machine leaves is stopped before the next one runs
export type Transition = { state: string; stop: boolean };

// The transition of each event of one state
export type Transitions = ReadonlyMap<string, Transition>;

export type Definition = {
  // the class that the file defines, if it names one
  dtClass?: DtClass;
  events: ReadonlySet<string>;
  states: ReadonlyMap<string, Transitions>;
  parameters: Declarations;
  properties: PropertyDeclarations;
  env: Env;
  // the env of each state, apart from its transitions
  stateEnv: ReadonlyMap<string, Env>;
  escalation: Escalation;
  managerCommands: string[];
  subscriptions: Subscription[];
  snapshot: SnapshotScripts;
  whatIf?: WhatIf;
};

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
    env: envSchema,
  })
  .strict()
  .nullish();

const fileSchema = z
  .object({
    class: classSchema,
    events: z.array(nameSchema).default([]),
    // a file without states only declares parameters and properties
    states: z.record(nameSchema, stateSchema).default({}),
    parameters: parametersSchema,
    properties: propertiesSchema,
    env: envSchema,
    escalation: escalationSchema,
    manager: managerSchema,
    subscriptions: subscriptionsSchema,
    snapshot: snapshotScriptsSchema,
    whatIf: whatIfSchema,
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

function toDefinition({ events, states, ...sections }: File): Definition {
  return {
    dtClass: sections.class,
    events: new Set(events),
    states: new Map(
      Object.entries(states).map(([state, value]) => [
        state,
        toTransitions(value?.transitions),
      ]),
    ),
    parameters: new Map(Object.entries(sections.parameters)),
    properties: new Map(Object.entries(sections.properties)),
    env: sections.env,
    stateEnv: new Map(
      Object.entries(states).map(([state, value]) => [state, value?.env ?? {}]),
    ),
    escalation: sections.escalation,
    managerCommands: sections.manager?.commands ?? [],
    subscriptions: sections.subscriptions,
    snapshot: sections.snapshot,
    whatIf: sections.whatIf,
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

// Without states nothing raises an event or takes one
function statelessProblems(definition: Definition): string[] {
  const { states, events, subscriptions } = definition;
  const idle = { events: events.size, subscriptions: subscriptions.length };
  return Object.entries(idle)
    .filter(([, count]) => states.size === 0 && count > 0)
    .map(([section]) => `${section} need states`);
}

// The problems of the states and transitions of a definition
function crossCheck(definition: Definition, known: Known): string[] {
  const problems: string[] = [];
  definition.states.forEach((transitions, state) => {
    if (!known.commands.includes(state)) {
      problems.push(`state ${state} is not a permitted command`);
    }
    problems.push(...transitionProblems(definition, state, transitions));
  });
  const cycle = completionCycle(definition);
  if (cycle !== undefined) {
    problems.push(`completion events loop forever: ${cycle.join(' -> ')}`);
  }
  return [
    ...problems,
    ...statelessProblems(definition),
    ...parameterProblems(definition),
    ...propertyProblems(definition),
    ...envProblems(definition, known.separated),
    ...managerProblems(definition.managerCommands, known.commands),
    ...subscriptionProblems(definition, known.peers),
    ...snapshotProblems(definition.snapshot, known.commands),
    ...whatIfProblems(definition.whatIf, definition.snapshot, known.commands),
  ];
}

const invalid = (file: string, problems: string): Error =>
  new Error(`Invalid state machine in ${file}:\n${problems}`);

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
  file: string,
  known: Known,
): Definition {
  const content = readYaml(text, file);
  const result = fileSchema.safeParse(content);
  if (!result.success) {
    const hints = oldEnumHints(field(content, 'parameters'));
    const problems = [z.prettifyError(result.error), ...hints];
    throw invalid(file, problems.join('\n'));
  }
  const definition = toDefinition(result.data);
  const problems = crossCheck(definition, known);
  if (problems.length > 0) {
    throw invalid(file, problems.map((problem) => `✖ ${problem}`).join('\n'));
  }
  return definition;
}
