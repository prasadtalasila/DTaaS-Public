import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import supertest from 'supertest';

export { startRunner } from './util';

const SCRIPTS = ['create', 'execute', 'terminate'];

const MACHINE_FILE = 'dt.yaml';

// A folder with a runner configuration, the scripts in both their
// Linux and Windows versions, and the state machine of the definition,
// which the configuration names when there is one. The loops are test
// scripts of test/data/scripts that run until they are stopped.
export function digitalTwin(
  definition: string | undefined,
  loops: string[] = [],
): string {
  const dir = mkdtempSync(join(tmpdir(), 'runner-fsm-'));
  const commands = [...SCRIPTS, ...loops];
  const config = `id: dt-1\nport: 5000\nlocation: '.'\ncommands: [${commands}]\n`;
  const machine = definition ? `stateMachine: ${MACHINE_FILE}\n` : '';
  writeFileSync(join(dir, 'runner.yaml'), config + machine);
  if (definition) {
    writeFileSync(join(dir, MACHINE_FILE), definition);
  }
  SCRIPTS.forEach((script) => {
    writeFileSync(join(dir, script), `#!/bin/sh\nprintf ${script}\n`, {
      mode: 0o755,
    });
    writeFileSync(join(dir, `${script}.ps1`), `Write-Output ${script}\n`);
  });
  loops
    .flatMap((loop) => [loop, `${loop}.ps1`])
    .forEach((file) =>
      copyFileSync(join('test', 'data', 'scripts', file), join(dir, file)),
    );
  return dir;
}

export const post = (app: INestApplication, route: string, body: object) =>
  supertest(app.getHttpServer()).post(route).send(body);

const pause = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 50);
  });

// Polls a GET route until its body passes the check
export async function poll(
  app: INestApplication,
  route: string,
  check: (body: Record<string, unknown>) => boolean,
) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const { body } = await supertest(app.getHttpServer()).get(route);
    if (check(body)) {
      return body;
    }
    await pause();
  }
  throw new Error(`GET ${route} did not pass the check`);
}

// Polls the machine until the script of the state has finished
export const settled = (app: INestApplication, state: string) =>
  poll(
    app,
    '/fsm',
    (body) => body.state === state && body.status !== 'running',
  );
