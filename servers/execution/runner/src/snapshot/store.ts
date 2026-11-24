import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SnapshotsConfig } from '../config/configuration.service.js';
import { listedSchema, SnapshotDto } from '../dto/snapshot.dto.js';

// The time in UTC to the millisecond, without the separators that a file
// name can not hold on Windows, such as 20261123T101502120Z
export const NAME = /^\d{8}T\d{9}Z$/;

export const MANIFEST = 'snapshot.json';

// The name of a snapshot whose save began at the ISO 8601 time
export const snapshotName = (time: string): string =>
  time.replace(/[-:.]/g, '');

// A directory that does not exist yet has no snapshots
async function names(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() ?? false;
}

// The snapshots of the directory of runner.yaml
export default class SnapshotStore {
  constructor(private readonly config: SnapshotsConfig) {}

  // The directory of the snapshot; a name not of a snapshot has none,
  // so that no other path can be named
  path(name: string): string | undefined {
    return NAME.test(name) ? join(this.config.directory, name) : undefined;
  }

  reply(name: string, { time, seq }: { time: string; seq: number }) {
    return { time, seq, path: join(this.config.given, name) };
  }

  // Oldest first, as the names sort by time; a directory without a
  // manifest is no snapshot
  async list(): Promise<SnapshotDto[]> {
    const listed = (await names(this.config.directory))
      .filter((name) => NAME.test(name))
      .sort((a, b) => a.localeCompare(b));
    const snapshots = await Promise.all(listed.map((name) => this.read(name)));
    return snapshots.filter((snapshot) => snapshot !== undefined);
  }

  private async read(name: string): Promise<SnapshotDto | undefined> {
    const file = join(this.config.directory, name, MANIFEST);
    try {
      const manifest = listedSchema.parse(
        JSON.parse(await readFile(file, 'utf8')),
      );
      return this.reply(name, manifest);
    } catch {
      return undefined;
    }
  }

  // Whether there was such a snapshot to remove
  async remove(name: string): Promise<boolean> {
    const directory = this.path(name);
    if (directory === undefined || !(await isDirectory(directory))) {
      return false;
    }
    await rm(directory, { recursive: true, force: true });
    return true;
  }
}
