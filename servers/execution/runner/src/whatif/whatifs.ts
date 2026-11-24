import { rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { currentCaller } from '../auth/caller-context.js';
import type Config from '../config/configuration.service.js';
import { ExecuteCommandDto, runOptions } from '../dto/command.dto.js';
import {
  endOf,
  toWhatIfRun,
  WhatIfEndDto,
  WhatIfReplyDto,
  WhatIfRunDto,
} from '../dto/whatif.dto.js';
import type FsmService from '../fsm/fsm.service.js';
import type { CommandResult } from '../interfaces/command.interface.js';
import type Queue from '../queue.service.js';
import type Snapshots from '../snapshot/snapshots.js';
import { snapshotName } from '../snapshot/store.js';
import { presentOf, Twin, writePresent } from './present.js';

// The directory of the copies, under the snapshot directory
export const WHAT_IF = 'what-if';

export type WhatIfHost = {
  config: Config;
  fsm: FsmService;
  queue: Queue;
  snapshots: Snapshots;
  twin: Twin;
};

export type EndListener = (data: WhatIfEndDto) => void;

// A what-if in progress: its run, and its copy
type Run = { id: number; name: string; directory: string };

const conflict = (status: string) => new ConflictException({ status });

// Runs a command of whatIf.commands on a private copy of the twin, which
// the save makes, without the address or the token of the API, and
// removes the copy once the run has ended
export default class WhatIfs {
  private readonly logger = new Logger(WhatIfs.name);

  // the what-ifs in progress by command name, until their copy is gone
  private readonly running = new Map<string, Run & { done: Promise<void> }>();

  private readonly listeners: EndListener[] = [];

  constructor(private readonly host: WhatIfHost) {}

  // Hears each what-if that ended, once its copy is gone
  onEnd(listener: EndListener): void {
    this.listeners.push(listener);
  }

  // At a start: the copies that a runner left as it crashed
  clearLeftovers(): void {
    const snapshots = this.host.config.getSnapshots();
    if (snapshots !== undefined) {
      const directory = join(snapshots.directory, WHAT_IF);
      rmSync(directory, { recursive: true, force: true });
    }
  }

  // A what-if of a command whose what-if runs joins it
  async ask(body: ExecuteCommandDto): Promise<WhatIfReplyDto> {
    const { name } = body;
    const commands = this.host.fsm.declared()?.whatIf?.commands ?? [];
    if (!commands.includes(name)) {
      throw new BadRequestException({ status: 'invalid command' });
    }
    const id = this.running.get(name)?.id ?? (await this.begin(body));
    return { id, name, status: 'running' };
  }

  result(id: number): WhatIfRunDto {
    const row = this.host.queue.whatIfRun(id);
    if (row === undefined) {
      throw new NotFoundException();
    }
    return toWhatIfRun(row);
  }

  // Stops the what-ifs in progress, and waits until their copies are gone
  async stop(): Promise<void> {
    const runs = [...this.running.values()];
    const { manager } = this.host.fsm;
    await Promise.all(runs.map(({ name }) => manager.stop(name)));
    await Promise.all(runs.map(({ done }) => done));
  }

  // Makes the copy while the twin is paused, then starts the run
  private async begin(body: ExecuteCommandDto): Promise<number> {
    const root = this.copies();
    if (this.host.fsm.manager.isRunning(body.name)) {
      throw conflict('command running');
    }
    const time = new Date().toISOString();
    const directory = join(root, snapshotName(time));
    const { snapshots, twin, fsm } = this.host;
    await snapshots.saveInto(directory, time, {
      record: false,
      stop: false,
      whatIf: (copy) => writePresent(copy, presentOf(twin, fsm)),
    });
    return this.start(body, directory);
  }

  // The directory of the copies; the checks of a save come first, and a
  // what-if needs access control, as without it any process of the host
  // may call the API that the script is kept from
  private copies(): string {
    const store = this.host.snapshots.checked();
    if (this.host.config.access() === undefined) {
      throw conflict('no access control');
    }
    return join(store.config.directory, WHAT_IF);
  }

  // The run is in the command history and the timeline from the start
  private start({ name, input }: ExecuteCommandDto, directory: string) {
    const { fsm, queue } = this.host;
    const env = fsm.environment(name, directory);
    const options = runOptions({ name, input }, env, currentCaller().by);
    let id = 0;
    const result = queue.timeline.command(
      { name, input },
      (onRun) =>
        fsm.manager.newCommand(name, undefined, {
          ...options,
          mode: 'what-if',
          onRun: (run) => {
            id = run;
            onRun(run);
          },
        }),
      'whatif',
    );
    const run = { id, name, directory };
    this.running.set(name, { ...run, done: this.follow(run, result) });
    return id;
  }

  // However the run ends, the copy goes; then the listeners hear of it
  private async follow(run: Run, result: Promise<CommandResult>) {
    let ended: WhatIfEndDto | undefined;
    try {
      ended = endOf(run, await result);
    } catch (error) {
      this.logger.error(`The what-if ${run.name} failed: ${error}`);
    } finally {
      await rm(run.directory, { recursive: true, force: true });
      this.running.delete(run.name);
    }
    const data = ended;
    if (data !== undefined) {
      this.listeners.forEach((listener) => listener(data));
    }
  }
}
