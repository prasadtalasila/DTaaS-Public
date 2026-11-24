import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import DescriptorService from 'src/descriptor.service';
import ExecaManager from 'src/execa-manager.service';
import { http, until } from './snapshot.util';
import { reinstated, reinstateTwin } from './reinstate.util';
import { startStoredRunner } from './util';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

// Saves with stop, and waits until the runner has shut down
async function saveAndStop(app: INestApplication): Promise<string> {
  const closed = new Promise<void>((resolve) => {
    app
      .get(DescriptorService)
      .snapshots()
      .onStop(async () => {
        await app.close();
        resolve();
      });
  });
  const { body } = await http(app).post('/snapshot').send({ stop: true });
  await closed;
  return body.path;
}

// Out of execution and back: save with stop, remove the database, and
// reinstate the twin under its own id
describe('Taking a twin out of execution and reinstating it end-to-end', () => {
  let dir: string;
  let app: INestApplication;

  beforeAll(async () => {
    dir = reinstateTwin();
    const first = await startStoredRunner(join(dir, 'runner.yaml'));
    await http(first).put('/properties').send({ beds: 2 });
    await http(first).post('/fsm/transition').send({ state: 'work' });
    const path = await saveAndStop(first);
    rmSync(join(dir, 'run'), { recursive: true, force: true });
    app = await reinstated(dir, 'runner.yaml', path);
  }, TIMEOUT);

  afterAll(async () => {
    await app.get(ExecaManager).stop();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should have its history and properties again', async () => {
    const history = (await http(app).get('/history')).body;
    const properties = (await http(app).get('/properties')).body;

    expect(history).toContainEqual(
      expect.objectContaining({ name: 'work', status: 'interrupted' }),
    );
    expect(JSON.stringify(properties)).toContain('"beds"');
  });

  it('Should go on at the next request', async () => {
    expect((await http(app).get('/fsm')).body).toMatchObject({
      state: 'work',
      status: 'interrupted',
    });

    await http(app).post('/fsm/event').send({ event: 'next' });
    await until(
      async () => (await http(app).get('/fsm')).body.state === 'done',
    );
    await http(app).post('/fsm/event').send({ event: 'again' });
    const { body } = await http(app).get('/fsm');

    expect(body).toMatchObject({ state: 'work', entry: 3 });
  });
});
