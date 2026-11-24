import { constants, existsSync } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { INestApplication, Logger } from '@nestjs/common';
import Config from '../config/configuration.service.js';
import DescriptorService from '../descriptor.service.js';
import { Reinstated } from '../dto/snapshot.dto.js';
import FsmService from '../fsm/fsm.service.js';
import Queue from '../queue.service.js';
import { differences } from './differences.js';
import {
  checkClass,
  checkDatabase,
  ReadManifest,
  readManifest,
} from './manifest.js';
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

// Runs the restore script of the class, if it names one and the
// snapshot has files/ for it
async function restoreFiles(twin: Twin, directory: string): Promise<void> {
  const name = twin.fsm.declared()?.snapshot.restore;
  const files = join(directory, 'files');
  if (name === undefined) {
    return;
  }
  if (!existsSync(files)) {
    logger.warn(`Skipped the restore script ${name}: ${files} does not exist`);
    return;
  }
  const reply = await runSnapshotScript(twin, name, files);
  if (reply.status !== 'success') {
    const outcome = JSON.stringify(reply);
    throw new Error(`The restore script ${name} did not succeed: ${outcome}`);
  }
}

// Opens the copied database and resumes the twin; on any failure the
// copy that this start made goes, so that a later start may copy again
async function resume(twin: Twin, directory: string, database: string) {
  try {
    twin.queue.open(database);
    await restoreFiles(twin, directory);
    twin.fsm.restore();
  } catch (error) {
    await discard(twin, database);
    throw error;
  }
}

// The copy and the side files of SQLite, which a later copy would replay;
// the failure of the resume is the one reported
async function discard(twin: Twin, database: string) {
  try {
    twin.queue.close();
  } catch (error) {
    logger.warn(`Could not close the copied database: ${String(error)}`);
  }
  const files = ['', '-wal', '-shm'].map((end) => `${database}${end}`);
  await Promise.all(files.map((file) => rm(file, { force: true })));
}

// Why a replay twin needs a class written for it
const NO_REPLAY =
  'the class has no whatIf.replay: true, and a class that was not written for a replay twin would act on the real twin from a second process';

// A replay twin starts its time at the save, and stamps the timeline
// with it from the first row it writes
function beginReplay({ config, fsm, queue }: Twin, manifest: ReadManifest) {
  const replay = config.replay();
  if (replay === undefined) {
    return;
  }
  if (fsm.declared()?.whatIf?.replay !== true) {
    throw new Error(`Can not start a replay twin: ${NO_REPLAY}`);
  }
  replay.begin({ of: manifest.id, time: manifest.time });
  queue.timeline.standFor(() => replay.at());
  logger.log(
    `A replay twin of ${manifest.id} at ${manifest.time}, at ${replay.scale} times the speed of the clock: it connects to no MQTT broker, follows no peer and sends no notification`,
  );
}

// Reinstating: check, compare, copy, restore, resume
async function reinstate(twin: Twin, directory: string): Promise<Reinstated> {
  const { config, fsm } = twin;
  const manifest = await readManifest(directory);
  const database = checkDatabase(config.getFile(), config.getDatabase());
  refuseScriptUser(twin);
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
  beginReplay(twin, manifest);
  await mkdir(dirname(database), { recursive: true });
  // refuses a database that appeared since the check
  await copyFile(join(directory, DATABASE), database, constants.COPYFILE_EXCL);
  await resume(twin, directory, database);
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
    fsm.restore();
    return;
  }
  const from = await reinstate({ config, fsm, queue }, snapshot);
  app.get(DescriptorService).reinstatedFrom(from);
}
