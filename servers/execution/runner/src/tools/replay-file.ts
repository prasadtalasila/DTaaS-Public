import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { nameSchema } from '../fsm/name.js';
import { timeSchema } from './times.js';
import { ToolError } from './tool-error.js';

const record = z.record(z.string(), z.unknown());

const values = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);

// The one input of a step, each sent as the row of its kind is
const INPUTS = {
  transition: nameSchema,
  event: nameSchema,
  command: z.strictObject({
    name: z.string().min(1),
    input: record.optional(),
  }),
  parameters: values,
  properties: record,
  peers: z.record(z.string(), z.boolean()),
  notice: z.strictObject({
    peer: nameSchema,
    kind: z.enum(['presence', 'state']),
    data: z.unknown(),
  }),
};

export type StepKind = keyof typeof INPUTS;

export const STEP_KINDS = Object.keys(INPUTS) as StepKind[];

const stepSchema = z
  .strictObject({ at: timeSchema, ...z.object(INPUTS).partial().shape })
  .refine(
    (step) =>
      STEP_KINDS.filter((kind) => step[kind] !== undefined).length === 1,
    `a step holds exactly one of ${STEP_KINDS.join(', ')}`,
  );

export type Step = z.infer<typeof stepSchema>;

const fileSchema = z
  .strictObject({
    start: z.string().min(1),
    inputs: z.string().min(1).optional(),
    steps: z.array(stepSchema).min(1).optional(),
    out: z.string().min(1),
    speed: z.number().positive().default(1),
    until: timeSchema.optional(),
    settle: z.number().min(0).default(30),
    set: z
      .strictObject({
        parameters: values.optional(),
        properties: record.optional(),
      })
      .optional(),
  })
  .refine(
    ({ inputs, steps }) => (inputs === undefined) !== (steps === undefined),
    { message: 'give inputs or steps, one of the two', path: ['inputs'] },
  );

// The replay file with its paths resolved against its directory
export type ReplayPlan = z.infer<typeof fileSchema> & { file: string };

function readYaml(file: string): unknown {
  try {
    return yaml.load(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ToolError(`Can not read the replay file ${file}: ${error}`);
  }
}

const invalid = (file: string, problems: string): ToolError =>
  new ToolError(`Invalid replay file ${file}:\n${problems}`);

export function readReplayFile(given: string): ReplayPlan {
  const file = resolve(given);
  const result = fileSchema.safeParse(readYaml(file));
  if (!result.success) {
    throw invalid(file, z.prettifyError(result.error));
  }
  const at = (path: string) => resolve(dirname(file), path);
  const plan = result.data;
  const { inputs } = plan;
  const resolved = { ...plan, start: at(plan.start), out: at(plan.out), file };
  if (existsSync(resolved.out)) {
    throw invalid(file, `✖ ${resolved.out} exists already\n  → at out`);
  }
  return { ...resolved, inputs: inputs === undefined ? undefined : at(inputs) };
}
