import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type Config from '../config/configuration.service.js';
import { Manifest, SaveBody, SnapshotDto } from '../dto/snapshot.dto.js';
import type FsmService from '../fsm/fsm.service.js';
import type Queue from '../queue.service.js';
import { runSnapshotScript } from './script.js';
import { DATABASE, manifestOf, writeParts } from './snapshot.js';
import SnapshotStore, { snapshotName } from './store.js';

// A save into a directory: whether it writes the snapshot row of the
// timeline, and whether the runner shuts down after it
export type SaveOptions = { record: boolean; stop: boolean };

export type StopListener = () => Promise<void>;

const conflict = (status: string, message?: string) =>
  new ConflictException(
    message === undefined ? { status } : { status, message },
  );

// Why a class with a save script can not be saved with scripts.user
const SEPARATED =
  'With scripts.user the save script runs as another account, which can not write into a snapshot that only the account of the runner reads. Leave out scripts.user, or keep what the scripts need in properties and name no save script.';

// Saves the twin into a directory while it is paused, and lists and
// removes the snapshots of the directory of runner.yaml
export default class Snapshots {
  private readonly logger = new Logger(Snapshots.name);

  private stopListener: StopListener | undefined;

  constructor(
    private readonly config: Config,
    private readonly fsm: FsmService,
    private readonly queue: Queue,
  ) {}

  // How the runner shuts down after a save with stop; main.ts closes it
  onStop(listener: StopListener): void {
    this.stopListener = listener;
  }

  list(): Promise<SnapshotDto[]> {
    return this.store().list();
  }

  async remove(name: string): Promise<void> {
    if (!(await this.store().remove(name))) {
      throw new NotFoundException();
    }
  }

  // A new snapshot of the directory, named by the time the save began
  async save({ stop }: SaveBody): Promise<SnapshotDto> {
    if (this.queue.mode() === 'memory') {
      throw conflict('no database');
    }
    const store = this.store();
    const time = new Date().toISOString();
    const name = snapshotName(time);
    const directory = store.path(name) as string;
    const manifest = await this.saveInto(directory, time, {
      record: true,
      stop,
    });
    return store.reply(name, manifest);
  }

  // Saves the twin, paused, into the directory, which must not exist;
  // after a save with stop the pause lasts while the runner shuts down
  async saveInto(
    directory: string,
    time: string,
    { record, stop }: SaveOptions,
  ): Promise<Manifest> {
    this.refuseSaveScript();
    this.fsm.pause.begin();
    let down = false;
    try {
      const manifest = await this.capture(directory, time);
      if (record) {
        const name = basename(directory);
        this.queue.timeline.record('snapshot', { time, name });
      }
      down = stop;
      return manifest;
    } finally {
      this.after(down);
    }
  }

  // The save script can not write into a directory that only the runner
  // reads, and must not join a run that has no DT_SNAPSHOT_DIR
  private refuseSaveScript(): void {
    const name = this.fsm.declared()?.snapshot.save;
    if (name !== undefined && this.config.getScriptUser() !== undefined) {
      throw conflict('save script of another account', SEPARATED);
    }
    if (name !== undefined && this.fsm.manager.isRunning(name)) {
      throw conflict('save script running');
    }
  }

  private after(down: boolean): void {
    if (!down) {
      this.fsm.pause.end();
      return;
    }
    this.fsm.pause.close();
    // after the reply, which HTTP and MQTT send as the save resolves
    setImmediate(() => void this.stop());
  }

  private store(): SnapshotStore {
    const snapshots = this.config.getSnapshots();
    if (snapshots === undefined) {
      throw conflict('no snapshot directory');
    }
    return new SnapshotStore(snapshots);
  }

  // Writes the parts of the runner, then runs the save script; a save
  // that fails leaves no directory
  private async capture(directory: string, time: string): Promise<Manifest> {
    await mkdir(dirname(directory), { recursive: true });
    // it holds the inputs and the logs of commands
    await mkdir(directory, { mode: 0o700 });
    try {
      const manifest = this.copyDatabase(directory, time);
      await writeParts(directory, manifest, {
        config: this.config.getFile(),
        stateMachine: this.config.getStateMachine(),
        scripts: this.config.getLocation(),
      });
      await this.runSaveScript(directory);
      return manifest;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  // The database, its last row and the machine at one moment, as nothing
  // runs between them
  private copyDatabase(directory: string, time: string): Manifest {
    const seq = this.queue.copyTo(join(directory, DATABASE));
    return manifestOf({
      id: this.config.getId(),
      dtClass: this.fsm.declared()?.dtClass,
      time,
      seq,
      machine: this.fsm.check(),
    });
  }

  // The save script of the class, if it names one, writes into files/
  private async runSaveScript(directory: string): Promise<void> {
    const name = this.fsm.declared()?.snapshot.save;
    if (name === undefined) {
      return;
    }
    const files = join(directory, 'files');
    await mkdir(files);
    const host = { config: this.config, fsm: this.fsm };
    const reply = await runSnapshotScript(host, name, files);
    if (reply.status !== 'success') {
      throw new HttpException(reply, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Stops the scripts that run, as a signal to the process group does,
  // since the shutdown waits for them. If the shutdown fails, the twin
  // goes on: the pause ends, and the held completions are handled.
  private async stop(): Promise<void> {
    this.logger.log('Shutting down after the save');
    try {
      await this.fsm.manager.stop();
      await this.stopListener?.();
    } catch (error) {
      this.logger.error(`Could not shut down after the save: ${error}`);
      this.fsm.pause.end();
    }
  }
}
