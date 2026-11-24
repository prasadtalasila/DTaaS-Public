import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { startStoredRunner } from './util';

// Each script in its Linux and its Windows version; work waits for the
// file go, save-ward saves ward.json and restore-ward brings it back
const scripts = (dir: string): Record<string, [string, string]> => {
  const [go, ward] = [join(dir, 'go'), join(dir, 'ward.json')];
  const back = join(dir, 'restored.json');
  return {
    work: [
      `while [ ! -e '${go}' ]; do sleep 0.05; done`,
      `while (-not (Test-Path '${go}')) { Start-Sleep -Milliseconds 50 }`,
    ],
    done: ['printf done', 'Write-Output done'],
    'save-ward': [
      `cp '${ward}' "$DT_SNAPSHOT_DIR/ward.json"`,
      `Copy-Item -LiteralPath '${ward}' -Destination (Join-Path $env:DT_SNAPSHOT_DIR ward.json)`,
    ],
    'restore-ward': [
      `cp "$DT_SNAPSHOT_DIR/ward.json" '${back}'`,
      `Copy-Item -LiteralPath (Join-Path $env:DT_SNAPSHOT_DIR ward.json) -Destination '${back}'`,
    ],
    'fail-restore': [
      'echo "no ward" >&2\nexit 3',
      'Write-Error "no ward"\nexit 3',
    ],
  };
};

const restoreLine = (restore: string | null): string =>
  restore === null ? '' : `  restore: ${restore}\n`;

// The class: a twin in work waits until next moves it to done; a
// restore script of null names none
export const machine = (restore: string | null = 'restore-ward') => `
class: {id: 'urn:dtaas:ward', version: '1.0.0'}
events: [next, again]
parameters:
  capacity:
    type: integer
    default: 2
    controllable: true
properties:
  beds:
    type: integer
    unit: beds
states:
  work:
    transitions:
      next: done
  done:
    transitions:
      again: work
snapshot:
  save: save-ward
${restoreLine(restore)}`;

// runner.yaml of the instance id, with the database run/<id>.db
export const config = (id: string, port: number) => `id: ${id}
port: ${port}
location: scripts
commands: [work, done, save-ward, restore-ward, fail-restore]
stateMachine: ward.fsm.yaml
database: run/${id}.db
snapshots:
  directory: snapshots
relationships:
  peers:
    - id: dt-8
      topic: dtaas/dt-8
      url: 'http://127.0.0.1:1'
    - id: dt-9
      topic: dtaas/dt-9
      url: 'http://127.0.0.1:1'
`;

function writeScripts(dir: string): void {
  const location = join(dir, 'scripts');
  mkdirSync(location);
  Object.entries(scripts(dir)).forEach(([name, [sh, ps1]]) => {
    writeFileSync(join(location, name), `#!/bin/sh\n${sh}\n`, { mode: 0o755 });
    writeFileSync(join(location, `${name}.ps1`), `${ps1}\n`);
  });
}

// A twin dt-1 in runner.yaml, and dt-2 in second.yaml of the same class
export function reinstateTwin(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runner-reinstate-'));
  writeScripts(dir);
  writeFileSync(join(dir, 'ward.json'), '{"beds":3}');
  writeFileSync(join(dir, 'ward.fsm.yaml'), machine());
  writeFileSync(join(dir, 'runner.yaml'), config('dt-1', 5000));
  writeFileSync(join(dir, 'second.yaml'), config('dt-2', 5001));
  return dir;
}

// Starts the runner of the file of the folder, from the snapshot
export const reinstated = (
  dir: string,
  file: string,
  snapshot: string,
): Promise<INestApplication> =>
  startStoredRunner(join(dir, file), join(dir, snapshot));
