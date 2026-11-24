import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import Signer from '../auth/signer.js';
import { snapshotName } from '../snapshot/store.js';
import type { Input } from './inputs.js';
import {
  freePort,
  newKeyPair,
  PRINCIPAL,
  replayConfig,
} from './replay-config.js';
import { readReplayFile, ReplayPlan } from './replay-file.js';
import { prepare, Prepared } from './replay-plan.js';
import ReplayTwin, { MAIN } from './replay-twin.js';
import { Counts, firstStep, sendAll, setProperties, settle } from './send.js';
import { gap } from './times.js';
import TwinClient from './twin-client.js';
import { complain, say } from './tool-error.js';

// One line of a dry run: the time, its offset, kind, caller and request
export function dryLine(input: Input, from: string, speed: number): string {
  const offset = (gap(from, input.time, speed) / 1000).toFixed(3);
  const { kind, by, method, path, body } = input;
  const caller = by ?? '-';
  return `${snapshotName(input.time)} +${offset}s ${kind} ${caller} ${method} ${path} ${JSON.stringify(body)}`;
}

// What a replay did, as replay.json holds it
export function summary(
  plan: ReplayPlan,
  prepared: Prepared,
  done: Counts & { firstStep: number | null },
) {
  const { manifest } = prepared.start;
  return {
    format: 1,
    of: manifest.id,
    start: plan.start,
    inputs: plan.inputs ?? null,
    from: { seq: manifest.seq, time: manifest.time },
    until: prepared.until,
    speed: plan.speed,
    set: plan.set ?? {},
    sent: done.sent,
    refused: done.refused,
    firstStep: done.firstStep,
  };
}

// Writes runner.yaml of the replay twin into out, and the client
async function setUp(plan: ReplayPlan, prepared: Prepared, main: string) {
  const { privateKey, publicKey } = newKeyPair();
  const port = await freePort();
  const { start } = prepared;
  const parameters = plan.set?.parameters;
  const config = replayConfig({
    start,
    out: plan.out,
    port,
    publicKey,
    parameters,
  });
  mkdirSync(plan.out, { recursive: true });
  writeFileSync(join(plan.out, 'runner.yaml'), yaml.dump(config));
  const twin = new ReplayTwin(plan.out, port, main);
  const signer = new Signer(privateKey, PRINCIPAL);
  return {
    twin,
    client: new TwinClient(twin.url(''), String(config.id), signer),
  };
}

const exit = {
  SIGINT: () => process.exit(130),
  SIGTERM: () => process.exit(143),
};

// The child ends with the tool, by a signal too; returns the undoing
function stopWith(twin: ReplayTwin): () => void {
  const kill = () => twin.kill();
  process.once('exit', kill);
  process.once('SIGINT', exit.SIGINT);
  process.once('SIGTERM', exit.SIGTERM);
  return () => {
    process.off('exit', kill);
    process.off('SIGINT', exit.SIGINT);
    process.off('SIGTERM', exit.SIGTERM);
  };
}

// A runner that shuts down waits for its scripts, so stop any that runs
// after settle
async function stopScripts(client: TwinClient, seconds: number) {
  if (!(await settle(client, seconds))) {
    complain(`The replay twin still ran a script after ${seconds} s: stopped`);
    await client.json({ method: 'POST', path: '/stop', body: {} });
  }
}

async function drive(plan: ReplayPlan, prepared: Prepared, client: TwinClient) {
  const { manifest } = prepared.start;
  const first = await firstStep(client, manifest);
  await setProperties(client, plan.set?.properties);
  const from = { from: manifest.time, speed: plan.speed };
  const counts = await sendAll(client, prepared.inputs, from);
  await stopScripts(client, plan.settle);
  return { ...counts, firstStep: first };
}

async function run(plan: ReplayPlan, prepared: Prepared, main: string) {
  const { twin, client } = await setUp(plan, prepared, main);
  const undo = stopWith(twin);
  try {
    twin.start(prepared.start.dir, plan.speed);
    await twin.ready();
    const done = await drive(plan, prepared, client);
    await twin.stop();
    const text = JSON.stringify(summary(plan, prepared, done), null, 2);
    writeFileSync(join(plan.out, 'replay.json'), `${text}\n`);
    say(
      `Sent ${done.sent} inputs, ${done.refused} refused; the replay is in ${plan.out}`,
    );
    return 0;
  } finally {
    await twin.stop();
    undo();
  }
}

// runner-replay: checks the file and the snapshots, then replays, or
// with dryRun prints the inputs; main is the runner to start
export async function replay(
  file: string,
  dryRun: boolean,
  main = MAIN,
): Promise<number> {
  const plan = readReplayFile(file);
  const prepared = await prepare(plan);
  if (dryRun) {
    const from = prepared.start.manifest.time;
    prepared.inputs.forEach((input) => say(dryLine(input, from, plan.speed)));
    return 0;
  }
  return run(plan, prepared, main);
}
