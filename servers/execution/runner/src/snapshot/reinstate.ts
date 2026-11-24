import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { INestApplication, Logger } from '@nestjs/common';
import Config from '../config/configuration.service.js';
import DescriptorService from '../descriptor.service.js';
import { Reinstated } from '../dto/snapshot.dto.js';
import FsmService from '../fsm/fsm.service.js';
import Queue from '../queue.service.js';
import { differences } from './differences.js';
import { checkClass, checkDatabase, readManifest } from './manifest.js';
import { runSnapshotScript } from './script.js';
import { DATABASE } from './snapshot.js';

type Twin = { config: Config; fsm: FsmService; queue: Queue };

const logger = new Logger('Reinstate');

// Why a class with a restore script can not be reinstated with scripts.user
const SEPARATED =
  'with scripts.user the restore script runs as another account, which can not read a snapshot that only the account of the runner reads. Leave out scripts.user to reinstate, then add it again, or name no restore script in the class and copy files/ of the snapshot by hand.';

function refuseScriptUser({ config, fsm }: Twin): void {
  const name = fsm.declared()?.snapshot.restore;
  if (name !== undefined && config.getScriptUser() !== undefined) {
    throw new Error(`Can not reinstate with ${config.getFile()}: ${SEPARATED}`);
  }
}

// Runs the restore script of the class, if it names one; when it fails,
// the copied database goes
async function restoreFiles(twin: Twin, directory: string, database: string) {
  const name = twin.fsm.declared()?.snapshot.restore;
  if (name === undefined) {
    return;
  }
  const reply = await runSnapshotScript(twin, name, join(directory, 'files'));
  if (reply.status !== 'success') {
    twin.queue.close();
    await rm(database, { force: true });
    const outcome = JSON.stringify(reply);
    throw new Error(`The restore script ${name} did not succeed: ${outcome}`);
  }
}

// Steps 1 to 4 of reinstating: check, compare, copy, restore
async function reinstate(twin: Twin, directory: string): Promise<Reinstated> {
  const { config, fsm, queue } = twin;
  const database = checkDatabase(config.getFile(), config.getDatabase());
  refuseScriptUser(twin);
  const manifest = await readManifest(directory);
  const dtClass = fsm.declared()?.dtClass;
  checkClass(directory, manifest.class, {
    dtClass,
    file: config.getStateMachine(),
  });
  const found = await differences(directory, manifest.class, {
    config,
    dtClass,
  });
  found.forEach((difference) => logger.warn(difference));
  await mkdir(dirname(database), { recursive: true });
  await copyFile(join(directory, DATABASE), database);
  queue.open(database);
  await restoreFiles(twin, directory, database);
  return { id: manifest.id, time: manifest.time, seq: manifest.seq };
}

// Opens the database of runner.yaml, from the snapshot in the directory
// if one is given, and resumes the machine stored there; main.ts starts
// a runner so, and a later option of the command line extends it
export async function openTwin(
  app: INestApplication,
  snapshot?: string,
): Promise<void> {
  const config = app.get(Config);
  const fsm = app.get(FsmService);
  const queue = app.get(Queue);
  if (snapshot === undefined) {
    queue.open(config.getDatabase());
  } else {
    const from = await reinstate({ config, fsm, queue }, snapshot);
    app.get(DescriptorService).reinstatedFrom(from);
  }
  fsm.restore();
}
