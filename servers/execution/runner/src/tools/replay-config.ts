import { generateKeyPairSync, KeyObject } from 'node:crypto';
import { createServer } from 'node:net';
import { relative } from 'node:path';
import type { SnapshotDir } from './snapshot-dir.js';

type Mapping = Record<string, unknown>;

// The one principal of a replay twin
export const PRINCIPAL = 'replay';

// A key pair made for one run; the private key stays in memory
export function newKeyPair(): { privateKey: KeyObject; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    publicKey: String(publicKey.export({ format: 'jwk' }).x),
  };
}

// A port of 127.0.0.1 that is free now; another process may take it
// before the runner binds, and the runner then does not come up
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

// What a replay twin leaves out, as it reaches nobody and signs nothing,
// or sets from the snapshot
const DROPPED = [
  'mqtt',
  'scripts',
  'snapshots',
  'auth',
  'relationships',
  'stateMachine',
];

export type ReplaySetup = {
  start: SnapshotDir;
  out: string;
  port: number;
  publicKey: string;
  parameters?: Mapping;
};

// A key and its mapping, left out when the mapping is empty or absent
const unlessEmpty = (key: string, value?: Mapping): Mapping =>
  value === undefined || Object.keys(value).length === 0
    ? {}
    : { [key]: value };

const kept = (copy: Mapping): Mapping =>
  Object.fromEntries(
    Object.entries(copy).filter(([key]) => !DROPPED.includes(key)),
  );

// runner.yaml of the replay twin, from the copy in the start: it reaches
// nobody, keeps the peers so that subscriptions bind, and lists one
// principal. Paths are relative to out, where the file and a copy of
// the scripts go.
export function replayConfig(setup: ReplaySetup): Mapping {
  const { start, out, port, publicKey, parameters } = setup;
  const { copy, stateMachine } = start;
  const peers = (copy.relationships as Mapping | undefined)?.peers ?? [];
  const values = { ...(copy.parameters as Mapping | undefined), ...parameters };
  const file = stateMachine && { stateMachine: relative(out, stateMachine) };
  return {
    ...kept(copy),
    id: `${String(copy.id)}.replay`,
    port,
    location: 'scripts',
    ...file,
    database: 'state.db',
    ...unlessEmpty('parameters', values),
    relationships: { peers },
    auth: { principals: [{ name: PRINCIPAL, role: 'operator', publicKey }] },
  };
}
