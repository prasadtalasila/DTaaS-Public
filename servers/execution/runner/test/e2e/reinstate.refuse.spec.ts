import {
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Logger } from '@nestjs/common';
import ExecaManager from 'src/execa-manager.service';
import { http } from './snapshot.util';
import { config, machine, reinstated, reinstateTwin } from './reinstate.util';
import { startStoredRunner } from './util';

// PowerShell takes a second or more to start on a loaded Windows host
const TIMEOUT = 30000;

describe('Reinstating refusals and warnings end-to-end', () => {
  let dir: string;
  let path: string;

  // A copy of the snapshot whose manifest the change makes
  function changedCopy(change: Record<string, unknown>): string {
    cpSync(join(dir, path), join(dir, 'changed'), { recursive: true });
    const file = join(dir, 'changed', 'snapshot.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...manifest, ...change }));
    return 'changed';
  }

  const refusal = (file: string, snapshot: string) =>
    reinstated(dir, file, snapshot).then(
      () => 'started',
      (error: Error) => error.message,
    );

  beforeAll(async () => {
    dir = reinstateTwin();
    const app = await startStoredRunner(join(dir, 'runner.yaml'));
    await http(app).post('/fsm/transition').send({ state: 'work' });
    path = (await http(app).post('/snapshot').send({})).body.path;
    await app.get(ExecaManager).stop();
    await app.close();
  }, TIMEOUT);

  afterEach(() => {
    rmSync(join(dir, 'changed'), { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should refuse a directory without a manifest', async () => {
    const file = join(dir, 'snapshots', 'none', 'snapshot.json');

    expect(await refusal('second.yaml', 'snapshots/none')).toBe(
      `Can not reinstate from ${file}: there is no manifest of a snapshot`,
    );
  });

  it('Should refuse a format that it does not know', async () => {
    const copy = changedCopy({ format: 2 });
    const file = join(dir, copy, 'snapshot.json');

    expect(await refusal('second.yaml', copy)).toBe(
      `Can not reinstate from ${file}: format 2 is not 1, the format that this runner reads`,
    );
  });

  it('Should refuse a class with another id', async () => {
    const copy = changedCopy({ class: { id: 'urn:other', version: '1.0.0' } });
    const [file, own] = [
      join(dir, copy, 'snapshot.json'),
      join(dir, 'ward.fsm.yaml'),
    ];

    expect(await refusal('second.yaml', copy)).toBe(
      `Can not reinstate from ${file}: the snapshot is of class urn:other, and ${own} is of class urn:dtaas:ward`,
    );
  });

  it('Should refuse a snapshot without a class for a file with one', async () => {
    const copy = changedCopy({ class: null });

    expect(await refusal('second.yaml', copy)).toContain(
      'the snapshot is without a class, and',
    );
  });

  it('Should refuse a database that exists', async () => {
    const database = join(dir, 'run', 'dt-1.db');

    expect(await refusal('runner.yaml', path)).toBe(
      `Can not reinstate into ${database}: the database exists already`,
    );
  });

  it('Should refuse a runner.yaml without a database', async () => {
    const text = config('dt-4', 5004).replace('database: run/dt-4.db\n', '');
    writeFileSync(join(dir, 'memory.yaml'), text);

    expect(await refusal('memory.yaml', path)).toBe(
      `Can not reinstate with ${join(dir, 'memory.yaml')}: it names no database`,
    );
  });

  it('Should stop with the outcome of a failing restore script, and leave no database', async () => {
    writeFileSync(join(dir, 'fail.fsm.yaml'), machine('fail-restore'));
    const text = config('dt-3', 5003).replace('ward.fsm.yaml', 'fail.fsm.yaml');
    writeFileSync(join(dir, 'failing.yaml'), text);

    const message = await refusal('failing.yaml', path);

    expect(message).toMatch(
      /^The restore script fail-restore did not succeed: \{"status":"failed".*no ward/,
    );
    expect(existsSync(join(dir, 'run', 'dt-3.db'))).toBe(false);
  });

  it('Should reinstate a class without a restore script', async () => {
    writeFileSync(join(dir, 'plain.fsm.yaml'), machine(null));
    const text = config('dt-6', 5006).replace(
      'ward.fsm.yaml',
      'plain.fsm.yaml',
    );
    writeFileSync(join(dir, 'plain.yaml'), text);

    const app = await reinstated(dir, 'plain.yaml', path);
    const { body } = await http(app).get('/history');
    await app.close();

    expect(body.map(({ name }: { name: string }) => name)).toEqual(['work']);
  });

  it(
    'Should warn of the parameters, the state machine file and the scripts that differ',
    async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');
      cpSync(join(dir, 'scripts'), join(dir, 'scripts-2'), { recursive: true });
      writeFileSync(
        join(dir, 'scripts-2', 'done'),
        '#!/bin/sh\nprintf other\n',
      );
      unlinkSync(join(dir, 'scripts-2', 'work'));
      writeFileSync(join(dir, 'other.fsm.yaml'), `${machine()}# changed\n`);
      const text = config('dt-5', 5005)
        .replace('location: scripts', 'location: scripts-2')
        .replace('ward.fsm.yaml', 'other.fsm.yaml');
      writeFileSync(
        join(dir, 'other.yaml'),
        `${text}parameters:\n  capacity: 5\n`,
      );

      const app = await reinstated(dir, 'other.yaml', path);
      await app.close();
      const warnings = warn.mock.calls.map(([text]) => text);

      expect(warnings).toEqual(
        expect.arrayContaining([
          'The parameter capacity is 5, and not set in the snapshot',
          `The state machine file ${join(dir, 'other.fsm.yaml')} is not the same as the copy ${join(dir, path, 'ward.fsm.yaml')} in the snapshot`,
          `The script ${join(dir, 'scripts-2', 'done')} is not the same as ${join(dir, path, 'scripts', 'done')} of the snapshot`,
          `The script ${join(dir, path, 'scripts', 'work')} of the snapshot is missing as ${join(dir, 'scripts-2', 'work')}`,
        ]),
      );
      expect(warnings).toHaveLength(4);
    },
    TIMEOUT,
  );
});
