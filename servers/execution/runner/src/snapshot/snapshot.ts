import { existsSync, readFileSync } from 'node:fs';
import { copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import type { FsmStateDto } from '../dto/fsm.dto.js';
import { Manifest, SNAPSHOT_FORMAT } from '../dto/snapshot.dto.js';
import type { DtClass } from '../fsm/class.js';
import { MANIFEST } from './store.js';

// The copy of the database in a snapshot, always under this name
export const DATABASE = 'state.db';

// The package.json nearest above this module: two levels up in src/,
// three in dist/src/
function packageFile(dir: string): string {
  const file = join(dir, 'package.json');
  const parent = dirname(dir);
  return existsSync(file) || parent === dir ? file : packageFile(parent);
}

let version: string | undefined;

// The version of the runner, read once
export function runnerVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  version ??= String(
    JSON.parse(readFileSync(packageFile(here), 'utf8')).version,
  );
  return version;
}

// The twin as the save finds it, at the moment of the copy
export type Twin = {
  id: string;
  dtClass?: DtClass;
  time: string;
  seq: number;
  machine?: FsmStateDto;
};

export const manifestOf = ({ dtClass, machine, ...twin }: Twin): Manifest => ({
  format: SNAPSHOT_FORMAT,
  runner: runnerVersion(),
  id: twin.id,
  class: dtClass ?? null,
  time: twin.time,
  seq: twin.seq,
  machine: machine
    ? { state: machine.state, entry: machine.entry, status: machine.status }
    : null,
});

type Mapping = Record<string, unknown>;

// Sets the key of a mapping that has it to the empty string
function blank(mapping: unknown, key: string): void {
  if (typeof mapping === 'object' && mapping !== null && key in mapping) {
    (mapping as Mapping)[key] = '';
  }
}

// The URL without the user and password that it may hold
function blankUserInfo(mqtt: unknown): void {
  const { url } = (mqtt ?? {}) as Mapping;
  if (typeof url !== 'string' || !url.includes('@')) {
    return;
  }
  // a URL that can not be read may hide its user information anywhere
  if (!URL.canParse(url)) {
    (mqtt as Mapping).url = '';
    return;
  }
  const parsed = new URL(url);
  parsed.username = '';
  parsed.password = '';
  (mqtt as Mapping).url = parsed.toString();
}

// runner.yaml without the MQTT password, the user information of the
// MQTT URL and the webhook token; the signing key is a path, and stays
// one
export function blankedConfig(text: string): string {
  const config = yaml.load(text) as Mapping;
  const manager = (config.relationships as Mapping | undefined)?.manager;
  blank(config.mqtt, 'password');
  blankUserInfo(config.mqtt);
  blank((manager as Mapping | undefined)?.notify, 'token');
  return yaml.dump(config);
}

// The files that the runner copies into a snapshot
export type Sources = {
  config: string;
  stateMachine?: string;
  scripts: string;
};

// Writes the manifest and copies runner.yaml, the state machine file
// under its own name, and the whole directory of the scripts
export async function writeParts(
  directory: string,
  manifest: Manifest,
  { config, stateMachine, scripts }: Sources,
): Promise<void> {
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(join(directory, MANIFEST), text);
  const runnerYaml = blankedConfig(await readFile(config, 'utf8'));
  await writeFile(join(directory, 'runner.yaml'), runnerYaml);
  if (stateMachine !== undefined) {
    await copyFile(stateMachine, join(directory, basename(stateMachine)));
  }
  await cp(scripts, join(directory, 'scripts'), { recursive: true });
}
