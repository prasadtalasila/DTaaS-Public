import { z } from 'zod';
import type { DtClass } from '../fsm/class.js';
import type { ScriptStatus } from './fsm.dto.js';

// The body of POST /snapshot, or the payload of MQTT snapshot/set; with
// stop, the runner shuts down after the save
export const saveSchema = z
  .object({ stop: z.boolean().default(false) })
  .prefault({});

export type SaveBody = z.infer<typeof saveSchema>;

// A snapshot as the routes show it: when the save began, the last row of
// the timeline before it, and its directory as runner.yaml gives it
export type SnapshotDto = { time: string; seq: number; path: string };

// The layout of a snapshot that this runner writes and reads
export const SNAPSHOT_FORMAT = 1;

// Where the state machine was; null without one
export type SavedMachine = {
  state: string | null;
  entry: number;
  status: ScriptStatus;
} | null;

// snapshot.json: what a snapshot is, so that a runner can check it
// before it opens more
export type Manifest = {
  format: number;
  runner: string;
  id: string;
  class: DtClass | null;
  time: string;
  seq: number;
  machine: SavedMachine;
};

// What the list reads of a manifest; a directory without it is no
// snapshot
export const listedSchema = z.object({ time: z.string(), seq: z.number() });

// The snapshot that a runner was reinstated from, for its start row
export type Reinstated = { id: string; time: string; seq: number };
