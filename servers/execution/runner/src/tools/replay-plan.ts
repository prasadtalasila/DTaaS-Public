import { join } from 'node:path';
import type { TimelineRow } from '../dto/timeline.dto.js';
import { DATABASE } from '../snapshot/snapshot.js';
import { Input, readRows, Roles, rowInputs, stepInputs } from './inputs.js';
import type { ReplayPlan, Step } from './replay-file.js';
import {
  checkPair,
  checkReplay,
  readSnapshot,
  SnapshotDir,
} from './snapshot-dir.js';
import { ToolError } from './tool-error.js';

// The last seq and the time of what a replay covers; a scenario has
// no seq, and without until no end
export type Until = { seq: number | null; time: string | null };

// What is sent, from where, and up to where
export type Prepared = { start: SnapshotDir; inputs: Input[]; until: Until };

type Principal = { name?: unknown; role?: unknown };

// The role of each principal of the copy of runner.yaml
function rolesOf({ copy }: SnapshotDir): Roles {
  const auth = copy.auth as { principals?: Principal[] } | undefined;
  const principals = auth?.principals ?? [];
  return new Map(
    principals.map(({ name, role }) => [String(name), String(role)]),
  );
}

// The last row before until, or the snapshot of the inputs
function untilOf(
  rows: TimelineRow[],
  inputs: SnapshotDir,
  until?: string,
): Until {
  const { seq, time } = inputs.manifest;
  if (until === undefined) {
    return { seq, time };
  }
  const before = rows.filter((row) => row.seq <= seq && row.time < until);
  return { seq: before.at(-1)?.seq ?? null, time: until };
}

async function fromSnapshot(
  plan: ReplayPlan,
  start: SnapshotDir,
): Promise<Prepared> {
  const inputs = await readSnapshot('inputs', String(plan.inputs));
  checkPair(start, inputs);
  const rows = readRows(join(inputs.dir, DATABASE), start.manifest.seq);
  const { seq } = inputs.manifest;
  const sent = rowInputs(rows, rolesOf(inputs), { seq, until: plan.until });
  return { start, inputs: sent, until: untilOf(rows, inputs, plan.until) };
}

// Each step comes after the time of the start
function fromSteps(
  steps: Step[],
  start: SnapshotDir,
  until?: string,
): Prepared {
  const { time } = start.manifest;
  const early = steps.findIndex(({ at }) => at < time);
  if (early >= 0) {
    throw new ToolError(
      `steps.${early}.at: ${steps[early].at} is before the start, ${time}`,
    );
  }
  return {
    start,
    inputs: stepInputs(steps, until),
    until: { seq: null, time: until ?? null },
  };
}

// Reads and checks the snapshots, and lists the inputs
export async function prepare(plan: ReplayPlan): Promise<Prepared> {
  const start = await readSnapshot('start', plan.start);
  checkReplay(start);
  return plan.steps === undefined
    ? fromSnapshot(plan, start)
    : fromSteps(plan.steps, start, plan.until);
}
