import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as yaml from 'js-yaml';
import { readConfig } from '../config/parse.js';
import { whatIfSchema } from '../fsm/class.js';
import { ReadManifest, readManifest } from '../snapshot/manifest.js';
import { ToolError } from './tool-error.js';

type Mapping = Record<string, unknown>;

// A snapshot as the tools read it: its manifest, the copy of runner.yaml
// and the copy of the state machine file, if it has one
export type SnapshotDir = {
  dir: string;
  manifest: ReadManifest;
  copy: Mapping;
  stateMachine?: string;
};

// The key of the replay file names the snapshot in a refusal
export async function readSnapshot(
  key: string,
  dir: string,
): Promise<SnapshotDir> {
  try {
    const manifest = await readManifest(dir);
    const copy = (readConfig(join(dir, 'runner.yaml')) ?? {}) as Mapping;
    const named = copy.stateMachine;
    const stateMachine =
      typeof named === 'string' ? join(dir, basename(named)) : undefined;
    return { dir, manifest, copy, stateMachine };
  } catch (error) {
    throw new ToolError(
      `${key}: ${dir} is no snapshot: ${(error as Error).message}`,
    );
  }
}

const twinOf = ({ manifest }: SnapshotDir): string =>
  `${manifest.id} of class ${manifest.class?.id ?? 'none'}`;

// Both snapshots are of one twin, and the inputs come after the start
export function checkPair(start: SnapshotDir, inputs: SnapshotDir): void {
  if (twinOf(start) !== twinOf(inputs)) {
    throw new ToolError(
      `start and inputs are snapshots of two twins: ${twinOf(start)}, and ${twinOf(inputs)}`,
    );
  }
  if (inputs.manifest.seq <= start.manifest.seq) {
    throw new ToolError(
      `inputs: ${inputs.dir} is not later than start: its seq ${inputs.manifest.seq} is not above ${start.manifest.seq}`,
    );
  }
}

// A file that can not be read allows nothing
function replayAllowed(file: string): boolean {
  try {
    const content = yaml.load(readFileSync(file, 'utf8')) as Mapping | null;
    return whatIfSchema.safeParse(content?.whatIf).data?.replay === true;
  } catch {
    return false;
  }
}

// The class allows a replay twin, which runs its scripts for real
export function checkReplay({ dir, stateMachine }: SnapshotDir): void {
  if (stateMachine === undefined || !replayAllowed(stateMachine)) {
    throw new ToolError(
      `start: the class of ${dir} has no whatIf.replay: true, so it allows no replay twin`,
    );
  }
}
