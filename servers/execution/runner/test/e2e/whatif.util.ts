import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import Access from 'src/auth/access';
import Config from 'src/config/configuration.service';
import { Caller, httpAuthorization, newCaller } from 'test/sign.util';
import { http, until } from './snapshot.util';

export const client = newCaller('cli');
export const manager = newCaller('manager-1');

const PRINCIPALS = [
  { name: 'cli', role: 'client' as const, publicKey: client.publicKey },
  { name: 'manager-1', role: 'manager' as const, publicKey: manager.publicKey },
];

// Each script in its Linux and its Windows version. forecast keeps its
// environment and a copy of its copy in the twin's directory, and
// prints its mode and input; slow waits for the file go.
const scripts = (dir: string): Record<string, [string, string]> => {
  const [seen, env, go, release] = ['seen', 'env', 'go', 'release'].map((f) =>
    join(dir, f),
  );
  return {
    work: ['printf work', 'Write-Output work'],
    'save-ward': [
      `printf '{"beds":3}' > "$DT_SNAPSHOT_DIR/ward.json"`,
      `Set-Content -Path (Join-Path $env:DT_SNAPSHOT_DIR ward.json) -Value '{"beds":3}'`,
    ],
    'fail-save': ['exit 3', 'exit 3'],
    'save-slow': [
      `while [ ! -e '${release}' ]; do sleep 0.05; done`,
      `while (-not (Test-Path '${release}')) { Start-Sleep -Milliseconds 50 }`,
    ],
    forecast: [
      `cp -R "$DT_WHATIF_DIR" '${seen}'\nenv > '${env}'\nprintf '{"mode":"%s","input":%s}' "$DT_MODE" "$(cat)"`,
      `Copy-Item -Recurse $env:DT_WHATIF_DIR '${seen}'\nGet-ChildItem env: | ForEach-Object { "$($_.Name)=$($_.Value)" } | Set-Content '${env}'\n$text = [Console]::In.ReadToEnd().Trim()\nWrite-Output ('{"mode":"' + $env:DT_MODE + '","input":' + $text + '}')`,
    ],
    'forecast-text': ['printf "no json"', 'Write-Output "no json"'],
    'forecast-fail': ['printf partial\nexit 3', 'Write-Output partial\nexit 3'],
    'forecast-hold': [
      `while [ "$DT_MODE" = what-if ] && [ ! -e '${go}' ]; do sleep 0.05; done`,
      `while ($env:DT_MODE -eq 'what-if' -and -not (Test-Path '${go}')) { Start-Sleep -Milliseconds 50 }`,
    ],
    'forecast-slow': [
      `while [ ! -e '${go}' ]; do sleep 0.05; done\nprintf '{"ok":true}'`,
      `while (-not (Test-Path '${go}')) { Start-Sleep -Milliseconds 50 }\nWrite-Output '{"ok":true}'`,
    ],
  };
};

const WHAT_IFS = [
  'forecast',
  'forecast-text',
  'forecast-fail',
  'forecast-slow',
  'forecast-hold',
];

const machine = (
  save: string,
) => `class: {id: 'urn:dtaas:ward', version: '1.0.0'}
events: [halt]
states:
  work:
  forecast-slow:
  forecast-hold:
    transitions:
      halt: {state: work, stop: true}
snapshot:
  save: ${save}
whatIf:
  commands: [${WHAT_IFS.join(', ')}]
manager:
  commands: [work, forecast]
`;

const config = (snapshots: boolean) => `id: dt-1
port: 5000
location: scripts
commands: [work, save-ward, fail-save, save-slow, ${WHAT_IFS.join(', ')}]
stateMachine: ward.fsm.yaml
database: run/dt.db
stopGrace: 500
${snapshots ? 'snapshots:\n  directory: snapshots\n' : ''}`;

// A twin with a database file and, unless told otherwise, a snapshot
// directory, whose class names the save script given
export function whatIfTwin(save = 'save-ward', snapshots = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'runner-whatif-'));
  const location = join(dir, 'scripts');
  mkdirSync(location);
  Object.entries(scripts(dir)).forEach(([name, [sh, ps1]]) => {
    writeFileSync(join(location, name), `#!/bin/sh\n${sh}\n`, { mode: 0o755 });
    writeFileSync(join(location, `${name}.ps1`), `${ps1}\n`);
  });
  writeFileSync(join(dir, 'runner.yaml'), config(snapshots));
  writeFileSync(join(dir, 'ward.fsm.yaml'), machine(save));
  return dir;
}

// Turns access control on, with a client and a manager
export function controlAccess(app: INestApplication): void {
  const access = new Access(PRINCIPALS, 'dt-1');
  jest.spyOn(app.get<Config>(Config), 'access').mockReturnValue(access);
}

type Method = 'get' | 'post' | 'delete';

// A request that the caller signed
export function call(
  app: INestApplication,
  caller: Caller,
  [method, path, body]: [Method, string, object?],
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
    .set('Authorization', httpAuthorization(caller, 'dt-1', signed));
  return text === undefined
    ? request
    : request.set('Content-Type', 'application/json').send(text);
}

// The run once it has ended
export async function ended(app: INestApplication, id: number) {
  let body: Record<string, unknown> = {};
  await until(async () => {
    body = (await call(app, client, ['get', `/whatif/${id}`])).body;
    return body.status !== 'running';
  });
  return body;
}
