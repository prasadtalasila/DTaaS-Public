import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from '@jest/globals';
import { HttpStatus, INestApplication } from '@nestjs/common';
import supertest from 'supertest';
import { startRunner } from './util';

const BASE = 'port: 5000\nlocation: .\ncommands: [create, execute]\n';

// Writes the configuration into the folder and starts the runner on it
async function startRunnerWith(dir: string, config: string) {
  writeFileSync(join(dir, 'runner.yaml'), config);
  return startRunner(join(dir, 'runner.yaml'));
}

describe('Runner descriptor end-to-end tests', () => {
  let dir: string;
  let app: INestApplication;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-dt-'));
  });

  afterEach(async () => {
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should describe a runner without attributes or a state machine', async () => {
    app = await startRunnerWith(dir, `id: dt-1\n${BASE}`);

    await supertest(app.getHttpServer())
      .get('/dt')
      .expect(HttpStatus.OK, {
        id: 'dt-1',
        attributes: {},
        commands: ['create', 'execute'],
        stateMachine: false,
      });
  });

  it('Should describe a runner with attributes and a state machine', async () => {
    writeFileSync(join(dir, 'dt.yaml'), 'states: {create: {}}');
    app = await startRunnerWith(
      dir,
      `id: hospital-1\n${BASE}stateMachine: dt.yaml\n` +
        'attributes: {city: Aarhus, beds: 120, open: true}\n',
    );

    await supertest(app.getHttpServer())
      .get('/dt')
      .expect(HttpStatus.OK, {
        id: 'hospital-1',
        attributes: { city: 'Aarhus', beds: 120, open: true },
        commands: ['create', 'execute'],
        stateMachine: true,
      });
  });
});
