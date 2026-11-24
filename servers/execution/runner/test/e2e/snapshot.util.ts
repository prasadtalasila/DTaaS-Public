import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import supertest from 'supertest';
import { startStoredRunner } from './util';

// Each script in its Linux and its Windows version; work waits for the
// file go of the twin, and save-ward for the file release
const scripts = (dir: string): Record<string, [string, string]> => {
  const [go, release] = [join(dir, 'go'), join(dir, 'release')];
  return {
    work: [
      `while [ ! -e '${go}' ]; do sleep 0.05; done`,
      `while (-not (Test-Path '${go}')) { Start-Sleep -Milliseconds 50 }`,
    ],
    done: ['printf done', 'Write-Output done'],
    'save-ward': [
      `while [ ! -e '${release}' ]; do sleep 0.05; done\nprintf '{"beds":3}' > "$DT_SNAPSHOT_DIR/ward.json"`,
      `while (-not (Test-Path '${release}')) { Start-Sleep -Milliseconds 50 }\nSet-Content -Path (Join-Path $env:DT_SNAPSHOT_DIR ward.json) -Value '{"beds":3}'`,
    ],
    'fail-save': [
      'echo "no ward" >&2\nexit 3',
      'Write-Error "no ward"\nexit 3',
    ],
  };
};

// The class: work ends by itself and moves on to done
const machine = (
  save: string,
) => `class: {id: 'urn:dtaas:ward', version: '1.0.0'}
events: [again]
states:
  work:
    transitions:
      $success: done
  done:
    transitions:
      again: work
snapshot:
  save: ${save}
`;

const config = (save: string) => `id: dt-1
port: 5000
location: scripts
commands: [work, done, save-ward, fail-save, loop]
stateMachine: ward.fsm.yaml
database: run/dt.db
stopGrace: 500
snapshots:
  directory: snapshots
  timeout: ${save === 'loop' ? 1000 : 30000}
mqtt:
  url: 'mqtt://127.0.0.1:1'
  topic: dtaas/dt-1
  password: secret
relationships:
  manager:
    notify:
      url: 'http://127.0.0.1:1/events'
      token: hidden
`;

function writeScripts(dir: string): void {
  const location = join(dir, 'scripts');
  mkdirSync(location);
  Object.entries(scripts(dir)).forEach(([name, [sh, ps1]]) => {
    writeFileSync(join(location, name), `#!/bin/sh\n${sh}\n`, { mode: 0o755 });
    writeFileSync(join(location, `${name}.ps1`), `${ps1}\n`);
  });
  ['loop', 'loop.ps1'].forEach((file) =>
    copyFileSync(join('test', 'data', 'scripts', file), join(location, file)),
  );
}

// A twin with a database file and a snapshot directory, whose class
// names the save script given
export function snapshotTwin(save = 'save-ward'): string {
  const dir = mkdtempSync(join(tmpdir(), 'runner-snapshot-'));
  writeScripts(dir);
  writeFileSync(join(dir, 'runner.yaml'), config(save));
  writeFileSync(join(dir, 'ward.fsm.yaml'), machine(save));
  return dir;
}

// Lets the script of work, or the save script, end
export const touch = (dir: string, file: 'go' | 'release') =>
  writeFileSync(join(dir, file), '');

export const startTwin = (dir: string): Promise<INestApplication> =>
  startStoredRunner(join(dir, 'runner.yaml'));

export const http = (app: INestApplication) => supertest(app.getHttpServer());

const pause = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 50);
  });

// Waits, every 50 ms for up to 20 s, until the check passes
export async function until(
  check: () => Promise<boolean>,
  left = 400,
): Promise<void> {
  if (await check()) {
    return;
  }
  if (left === 0) {
    throw new Error('The check did not pass');
  }
  await pause();
  await until(check, left - 1);
}

export const saving = async (app: INestApplication) =>
  (await http(app).get('/health')).body.saving === true;
