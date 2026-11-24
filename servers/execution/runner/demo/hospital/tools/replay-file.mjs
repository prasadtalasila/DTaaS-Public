// Prints the replay file of the demo: a replay of hospital-1 from its
// first snapshot, with the inputs up to its last, under the scope given
// (multi by default). Its paths are relative to run/, where it goes.
import { readdirSync } from 'node:fs';

const scope = process.argv[2] ?? 'multi';
const snapshots = readdirSync('run/hospital-1/snapshots')
  .filter((name) => name !== 'what-if')
  .sort();
const at = (name) => `hospital-1/snapshots/${name}`;
process.stdout
  .write(`# hospital-1 again, from its first save, under scope ${scope}
start: ${at(snapshots[0])}
inputs: ${at(snapshots.at(-1))}
out: replays/scope-${scope}
speed: 2
settle: 2
set:
  parameters:
    scope: ${scope}
`);
