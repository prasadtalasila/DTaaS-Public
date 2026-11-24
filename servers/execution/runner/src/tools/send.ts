import type { ReadManifest } from '../snapshot/manifest.js';
import type { Input } from './inputs.js';
import { gap, sleep } from './times.js';
import { ToolError } from './tool-error.js';
import type TwinClient from './twin-client.js';

export type Counts = { sent: number; refused: number };

// Replay-Seq and Replay-By of a row of the twin; a step has neither
const originHeaders = ({ by, seq }: Input): Record<string, string> =>
  seq === undefined
    ? {}
    : {
        'Replay-Seq': String(seq),
        ...(by === null ? {} : { 'Replay-By': by }),
      };

// Whether the replay twin refused the input; a 5xx ends the replay
export async function sendInput(
  client: TwinClient,
  input: Input,
): Promise<boolean> {
  const { method, path, body } = input;
  const reply = await client.call({
    method,
    path,
    body,
    headers: originHeaders(input),
  });
  if (reply.status >= 500) {
    const reason = `${reply.status} ${await reply.text()}`;
    throw new ToolError(
      `The replay twin failed ${method} ${path}: ${reason}`,
      1,
    );
  }
  return reply.status >= 400;
}

// Sends each input at its time after that of the start, over the speed,
// counted from now; a late one at once, and a command that got a stored
// reply never
export async function sendAll(
  client: TwinClient,
  inputs: Input[],
  { from, speed }: { from: string; speed: number },
): Promise<Counts> {
  const begin = Date.now();
  const counts = { sent: 0, refused: 0 };
  const send = async (input: Input) => {
    await sleep(begin + gap(from, input.time, speed) - Date.now());
    const refused = await sendInput(client, input);
    counts.sent += 1;
    counts.refused += Number(refused);
  };
  const sent = inputs.filter(({ stored }) => stored === undefined);
  await sent.reduce(
    (chain, input) => chain.then(() => send(input)),
    Promise.resolve(),
  );
  return counts;
}

type Rows = { seq: number }[];

type Machine = ReadManifest['machine'];

// The saved state, when its script was running at the save
const runningState = (machine: Machine): string | null =>
  machine?.status === 'running' ? machine.state : null;

// When the script of the saved state was running, enters that state
// again, so that it runs; the seq of that entry, the first since the
// save, or null
export async function firstStep(
  client: TwinClient,
  { machine, seq }: ReadManifest,
): Promise<number | null> {
  const state = runningState(machine);
  if (state === null) {
    return null;
  }
  await client.json({
    method: 'POST',
    path: '/fsm/transition',
    body: { state },
  });
  const path = `/timeline?after=${seq}&kind=entry&limit=1`;
  const [entry] = (await client.json({ method: 'GET', path })) as Rows;
  if (entry === undefined) {
    throw new ToolError(
      'The replay twin recorded no entry for the first step',
      1,
    );
  }
  return entry.seq;
}

// Writes set.properties, which the configuration can not hold
export async function setProperties(
  client: TwinClient,
  properties?: Record<string, unknown>,
): Promise<void> {
  if (properties !== undefined) {
    await client.json({ method: 'PUT', path: '/properties', body: properties });
  }
}

const running = async (client: TwinClient): Promise<boolean> => {
  const fsm = (await client.json({ method: 'GET', path: '/fsm' })) as {
    status: string;
  };
  return fsm.status === 'running';
};

// Waits until no script of the replay twin runs, by GET /fsm, for the
// seconds given at most; whether it is idle
export async function settle(
  client: TwinClient,
  seconds: number,
): Promise<boolean> {
  const deadline = Date.now() + seconds * 1000;
  const idle = async (): Promise<boolean> => {
    const busy = await running(client);
    if (!busy || Date.now() >= deadline) {
      return !busy;
    }
    await sleep(100);
    return idle();
  };
  return idle();
}
