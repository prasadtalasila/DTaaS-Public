import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import * as yaml from 'js-yaml';
import type Config from '../config/configuration.service.js';
import type { DtClass } from '../fsm/class.js';

type Mapping = Record<string, unknown>;

// What the runner compares with the copies in a snapshot
export type Own = {
  config: Config;
  dtClass?: DtClass;
};

// The bytes of a file, or nothing if it can not be read
const bytes = (file: string): Promise<Buffer | undefined> =>
  readFile(file).catch(() => undefined);

async function same(a?: string, b?: string): Promise<boolean> {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  const [first, second] = await Promise.all([bytes(a), bytes(b)]);
  return first?.toString('base64') === second?.toString('base64');
}

// The copy of runner.yaml in the snapshot, empty if it has none
async function savedConfig(directory: string): Promise<Mapping> {
  const text = await readFile(join(directory, 'runner.yaml'), 'utf8').catch(
    () => '{}',
  );
  return yaml.load(text) as Mapping;
}

const shown = (value: unknown): string =>
  value === undefined ? 'not set' : JSON.stringify(value);

function parameterDifferences(own: Mapping, saved: Mapping): string[] {
  const names = [...new Set([...Object.keys(saved), ...Object.keys(own)])];
  return names
    .filter((name) => shown(own[name]) !== shown(saved[name]))
    .map(
      (name) =>
        `The parameter ${name} is ${shown(own[name])}, and ${shown(saved[name])} in the snapshot`,
    );
}

async function machineDifference(
  directory: string,
  own: string | undefined,
  saved: unknown,
): Promise<string[]> {
  const copy =
    typeof saved === 'string' ? join(directory, basename(saved)) : undefined;
  if (await same(own, copy)) {
    return [];
  }
  return [
    `The state machine file ${own ?? '(none)'} is not the same as the copy ${copy ?? '(none)'} in the snapshot`,
  ];
}

async function scriptDifference(
  copy: string,
  own: string,
): Promise<string | undefined> {
  if ((await bytes(own)) === undefined) {
    return `The script ${copy} of the snapshot is missing as ${own}`;
  }
  return (await same(own, copy))
    ? undefined
    : `The script ${own} is not the same as ${copy} of the snapshot`;
}

// Each script of the copy that location lacks or has otherwise
async function scriptDifferences(
  directory: string,
  location: string,
): Promise<string[]> {
  const scripts = join(directory, 'scripts');
  const entries = await readdir(scripts, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => []);
  const found = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .map((copy) =>
        scriptDifference(copy, join(location, relative(scripts, copy))),
      ),
  );
  return found.filter((text) => text !== undefined);
}

function versionDifference(
  saved: DtClass | null,
  own: DtClass | undefined,
): string[] {
  if (!saved || !own || saved.version === own.version) {
    return [];
  }
  return [
    `The snapshot is of version ${saved.version} of class ${saved.id}, and the state machine file of version ${own.version}`,
  ];
}

// Each difference that matters between the twin of runner.yaml and the
// copies in the snapshot; runner.yaml is the one that counts
export async function differences(
  directory: string,
  saved: DtClass | null,
  { config, dtClass }: Own,
): Promise<string[]> {
  const copy = await savedConfig(directory);
  const parameters = (copy.parameters ?? {}) as Mapping;
  return [
    ...versionDifference(saved, dtClass),
    ...parameterDifferences(config.getParameters(), parameters),
    ...(await machineDifference(
      directory,
      config.getStateMachine(),
      copy.stateMachine,
    )),
    ...(await scriptDifferences(directory, config.getLocation())),
  ];
}
