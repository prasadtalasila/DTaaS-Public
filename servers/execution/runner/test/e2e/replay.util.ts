import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as yaml from 'js-yaml';
import { INestApplication } from '@nestjs/common';
import { newCaller } from 'test/sign.util';
import { call, stopRunner } from './replay-twin.util';
import { until } from './snapshot.util';
import { startStoredRunner } from './util';

// Each script in its Linux and its Windows version; work fails unless
// the capacity is 2, and else waits for the file go
const scripts = (go: string): Record<string, [string, string]> => ({
  idle: ['printf idle', 'Write-Output idle'],
  work: [
    `[ "$DT_PARAM_CAPACITY" = 2 ] || exit 1\nwhile [ ! -e '${go}' ]; do sleep 0.05; done`,
    `if ($env:DT_PARAM_CAPACITY -ne '2') { exit 1 }\nwhile (-not (Test-Path '${go}')) { Start-Sleep -Milliseconds 50 }`,
  ],
  ok: ['printf ok', 'Write-Output ok'],
  failed: ['printf failed', 'Write-Output failed'],
});

// The class, which allows a replay twin
const MACHINE = `class: {id: 'urn:dtaas:ward', version: '1.0.0'}
events: [next]
parameters:
  capacity:
    type: integer
    default: 2
    controllable: true
states:
  idle:
    transitions:
      next: work
  work:
    transitions:
      $success: ok
      $failure: failed
  ok:
  failed:
whatIf:
  replay: true
`;

// The client of the twin, which sends every request of the tests
export const alice = newCaller('alice');

const AUTH = `auth:
  principals:
    - {name: alice, role: client, publicKey: ${alice.publicKey}}
`;

const config = (auth: boolean) => `id: dt-1
port: 5000
location: scripts
commands: [idle, work, ok, failed]
stateMachine: ward.fsm.yaml
database: run/dt-1.db
snapshots:
  directory: snapshots
${auth ? AUTH : ''}`;

// The twin dt-1 in runner.yaml of a new directory, with access control
// unless told otherwise
export function wardTwin(auth = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'runner-replays-'));
  const location = join(dir, 'scripts');
  mkdirSync(location);
  Object.entries(scripts(join(dir, 'go'))).forEach(([name, [sh, ps1]]) => {
    writeFileSync(join(location, name), `#!/bin/sh\n${sh}\n`, { mode: 0o755 });
    writeFileSync(join(location, `${name}.ps1`), `${ps1}\n`);
  });
  writeFileSync(join(dir, 'ward.fsm.yaml'), MACHINE);
  writeFileSync(join(dir, 'runner.yaml'), config(auth));
  return dir;
}

// The start and the inputs snapshot, as paths relative to the twin
export type Pair = { start: string; inputs: string };

// A request of alice to the twin, which ignores the signature without
// access control
const ask = (twin: INestApplication, path: string, body?: object) =>
  call(
    twin,
    [alice, 'dt-1'],
    [body === undefined ? 'get' : 'post', path, body],
  );

const save = async (twin: INestApplication): Promise<string> =>
  (await ask(twin, '/snapshot', {})).body.path;

const settled = (twin: INestApplication, state: string) =>
  until(async () => {
    const { body } = await ask(twin, '/fsm');
    return body.state === state && body.status !== 'running';
  });

// Saved idle once its script ended, then moved to ok by next
export async function endedPair(dir: string): Promise<Pair> {
  const twin = await startStoredRunner(join(dir, 'runner.yaml'));
  await ask(twin, '/fsm/transition', { state: 'idle' });
  await settled(twin, 'idle');
  const start = await save(twin);
  writeFileSync(join(dir, 'go'), '');
  await ask(twin, '/fsm/event', { event: 'next' });
  await settled(twin, 'ok');
  const inputs = await save(twin);
  await stopRunner(twin);
  return { start, inputs };
}

// Saved while the script of work ran, which then ended and moved to ok
export async function runningPair(dir: string): Promise<Pair> {
  const twin = await startStoredRunner(join(dir, 'runner.yaml'));
  await ask(twin, '/fsm/transition', { state: 'work' });
  const start = await save(twin);
  writeFileSync(join(dir, 'go'), '');
  await settled(twin, 'ok');
  const inputs = await save(twin);
  await stopRunner(twin);
  return { start, inputs };
}

export function replayFile(dir: string, name: string, content: object): string {
  const file = join(dir, name);
  writeFileSync(file, yaml.dump(content));
  return file;
}

export type Ran = { code: number; stdout: string; stderr: string };

// Runs a built tool, as an operator does
export async function tool(
  name: 'replay' | 'compare',
  args: string[],
  cwd: string,
): Promise<Ran> {
  const main = join(process.cwd(), 'dist', 'src', 'tools', `${name}.js`);
  const ran = promisify(execFile)(process.execPath, [main, ...args], { cwd });
  return ran.then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: Ran) => ({
      code: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    }),
  );
}
