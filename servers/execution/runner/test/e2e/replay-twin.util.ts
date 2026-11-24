import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import ExecaManager from 'src/execa-manager.service';
import { TimelineRow } from 'src/dto/timeline.dto';
import { Caller, httpAuthorization, newCaller } from 'test/sign.util';
import { http, until } from './snapshot.util';
import { startStoredRunner } from './util';

export const operator = newCaller('replay');
export const client = newCaller('cli');

// Each script in its Linux and its Windows version; work keeps its
// environment in the file env
const scripts = (dir: string): Record<string, [string, string]> => ({
  idle: ['printf idle', 'Write-Output idle'],
  work: [
    `env > '${join(dir, 'env')}'`,
    `Get-ChildItem env: | ForEach-Object { "$($_.Name)=$($_.Value)" } | Set-Content '${join(dir, 'env')}'`,
  ],
  done: ['printf done', 'Write-Output done'],
});

// The class, which allows a replay twin unless told otherwise; the
// neighbour dt-8 going offline moves an idle twin to done
const machine = (replay: boolean) => `
class: {id: 'urn:dtaas:ward', version: '1.0.0'}
events: [next, neighbour-down]
subscriptions:
  - peer: dt-8
    when:
      online: false
    event: neighbour-down
states:
  idle:
    transitions:
      next: work
      neighbour-down: done
  work:
  done:
${replay ? 'whatIf:\n  replay: true\n' : ''}`;

const PEERS = `relationships:
  peers:
    - id: dt-8
      topic: dtaas/dt-8
`;

const AUTH = `auth:
  principals:
    - {name: replay, role: operator, publicKey: ${operator.publicKey}}
    - {name: cli, role: client, publicKey: ${client.publicKey}}
`;

// runner.yaml of the instance id, with the database run/<id>.db, the
// class of the file given, and access control if asked
const config = (id: string, fsm: string, auth: boolean) => `id: ${id}
port: 5000
location: scripts
commands: [idle, work, done]
stateMachine: ${fsm}
database: run/${id}.db
snapshots:
  directory: snapshots
${PEERS}${auth ? AUTH : ''}`;

// The twin dt-1 in runner.yaml; replay.yaml and plain.yaml are second
// twins with access control, the second of a class without the replay
export function replayTwin(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runner-replay-'));
  const location = join(dir, 'scripts');
  mkdirSync(location);
  Object.entries(scripts(dir)).forEach(([name, [sh, ps1]]) => {
    writeFileSync(join(location, name), `#!/bin/sh\n${sh}\n`, { mode: 0o755 });
    writeFileSync(join(location, `${name}.ps1`), `${ps1}\n`);
  });
  writeFileSync(join(dir, 'ward.fsm.yaml'), machine(true));
  writeFileSync(join(dir, 'plain.fsm.yaml'), machine(false));
  writeFileSync(
    join(dir, 'runner.yaml'),
    config('dt-1', 'ward.fsm.yaml', false),
  );
  writeFileSync(
    join(dir, 'replay.yaml'),
    config('dt-1.replay', 'ward.fsm.yaml', true),
  );
  writeFileSync(
    join(dir, 'plain.yaml'),
    config('dt-1.plain', 'plain.fsm.yaml', true),
  );
  writeFileSync(
    join(dir, 'live.yaml'),
    config('dt-1.live', 'ward.fsm.yaml', true),
  );
  return dir;
}

type Method = 'get' | 'post' | 'put';

// A request that the caller signed for the runner id, with the headers
// given
export function call(
  app: INestApplication,
  [caller, aud]: readonly [Caller, string],
  [method, path, body]: [Method, string, object?],
  headers: Record<string, string> = {},
) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  // the signature covers the path without its query
  const signed = {
    method: method.toUpperCase(),
    path: path.split('?')[0],
    body: text,
  };
  const request = http(app)
    [method](path)
    .set(headers)
    .set('Authorization', httpAuthorization(caller, aud, signed));
  return text === undefined
    ? request
    : request.set('Content-Type', 'application/json').send(text);
}

export async function stopRunner(app: INestApplication): Promise<void> {
  await app.get(ExecaManager).stop();
  await app.close();
}

export type Saved = {
  dir: string;
  snapshot: string;
  manifest: { id: string; time: string; seq: number };
};

// The twin dt-1 saved idle, once the script of idle ended
export async function savedTwin(): Promise<Saved> {
  const dir = replayTwin();
  const twin = await startStoredRunner(join(dir, 'runner.yaml'));
  await http(twin).post('/fsm/transition').send({ state: 'idle' });
  await until(
    async () => (await http(twin).get('/fsm')).body.status === 'valid',
  );
  const { path } = (await http(twin).post('/snapshot').send({})).body;
  await stopRunner(twin);
  const snapshot = join(dir, path);
  const file = join(snapshot, 'snapshot.json');
  return { dir, snapshot, manifest: JSON.parse(readFileSync(file, 'utf8')) };
}

// The rows that a runner of the id wrote since the reinstate
export const rowsSince = async (
  app: INestApplication,
  aud: string,
  { manifest }: Saved,
): Promise<TimelineRow[]> =>
  (
    await call(
      app,
      [operator, aud],
      ['get', `/timeline?after=${manifest.seq}&limit=1000`],
    )
  ).body;
