import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as yaml from 'js-yaml';
import { createSchema } from 'src/queue.schema';

// A row as a test writes it into a timeline
export type Row = {
  kind: string;
  data: object;
  by?: string | null;
  time?: string;
  at?: string;
  origin?: object;
};

export const newDir = (): string =>
  mkdtempSync(join(tmpdir(), 'runner-tools-'));

// A database with the rows given, seq 1 first, and commands with the
// cpu seconds given
export function writeDb(file: string, rows: Row[], cpu: number[] = []): void {
  const db = new DatabaseSync(file);
  createSchema(db);
  const insert = db.prepare(
    'INSERT INTO timeline (time, kind, by, data, at, origin) VALUES (?, ?, ?, ?, ?, ?)',
  );
  rows.forEach(({ kind, data, by = null, time, at, origin }, index) =>
    insert.run(
      time ?? new Date(Date.UTC(2026, 10, 24, 10, 0, index)).toISOString(),
      kind,
      by,
      JSON.stringify(data),
      at ?? null,
      origin === undefined ? null : JSON.stringify(origin),
    ),
  );
  const command = db.prepare(
    'INSERT INTO commands (name, cpu_seconds) VALUES (?, ?)',
  );
  cpu.forEach((seconds) => command.run('work', seconds));
  db.close();
}

export const MACHINE = `class: {id: 'urn:dtaas:ward', version: '1.0.0'}
states:
  idle:
whatIf:
  replay: true
`;

export type Fake = {
  id?: string;
  time: string;
  seq: number;
  machine?: object | null;
  config?: object;
  rows?: Row[];
};

// A snapshot directory of the twin dt-1 with the manifest, the copy of
// runner.yaml, the class and the database given
export function fakeSnapshot(dir: string, name: string, fake: Fake): string {
  const path = join(dir, name);
  mkdirSync(join(path, 'scripts'), { recursive: true });
  const { id = 'dt-1', time, seq, machine = null } = fake;
  const dtClass = { id: 'urn:dtaas:ward', version: '1.0.0' };
  const manifest = {
    format: 1,
    runner: '0.14.0',
    id,
    class: dtClass,
    time,
    seq,
    machine,
  };
  writeFileSync(join(path, 'snapshot.json'), JSON.stringify(manifest));
  const config = fake.config ?? {
    id,
    port: 5000,
    location: 'scripts',
    commands: [],
    stateMachine: 'ward.fsm.yaml',
  };
  writeFileSync(join(path, 'runner.yaml'), yaml.dump(config));
  writeFileSync(join(path, 'ward.fsm.yaml'), MACHINE);
  writeDb(join(path, 'state.db'), fake.rows ?? []);
  return path;
}
