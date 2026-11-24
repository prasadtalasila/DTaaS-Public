import { rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
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

  // the id of each what-if by command name, from the request until its
  // copy is gone, so that a request while the copy is made joins too
  private readonly asked = new Map<string, Promise<number>>();

  // the end of each what-if whose run started, by command name
  private readonly running = new Map<string, Promise<void>>();

  private stopping = false;

  private readonly listeners: EndListener[] = [];

  constructor(private readonly host: WhatIfHost) {}

  // Hears each what-if that ended, once its copy is gone
  onEnd(listener: EndListener): void {
    this.listeners.push(listener);
  }

  // At a start: the copies that a runner left as it crashed
  clearLeftovers(): void {
    const root = this.root();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // The directory of the copies, under the snapshot directory
  private root(): string | undefined {
    const snapshots = this.host.config.getSnapshots();
    return snapshots && join(snapshots.directory, WHAT_IF);
  }

  // A what-if of a command whose what-if runs joins it
  async ask(body: ExecuteCommandDto): Promise<WhatIfReplyDto> {
    const { name } = body;
    const commands = this.host.fsm.declared()?.whatIf?.commands ?? [];
    if (!commands.includes(name)) {
      throw new BadRequestException({ status: 'invalid command' });
    }
    const id = await (this.asked.get(name) ?? this.request(body));
    return { id, name, status: 'running' };
  }

  // A request that failed is forgotten; none starts once stopping
  private request(body: ExecuteCommandDto): Promise<number> {
    if (this.stopping) {
      throw new ServiceUnavailableException({ status: 'shutting down' });
    }
    const id = this.begin(body);
    this.asked.set(body.name, id);
    id.catch(() => this.asked.delete(body.name));
    return id;
  }

  result(id: number): WhatIfRunDto {
    const row = this.host.queue.whatIfRun(id);
    if (row === undefined) {
      throw new NotFoundException();
    }
    return toWhatIfRun(row);
  }

  // Stops the what-ifs in progress, also one whose copy is being made,
  // and waits until their copies are gone; none of them tells its end
  async stop(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled([...this.asked.values()]);
    const { manager } = this.host.fsm;
    const names = [...this.running.keys()];
    await Promise.all(names.map((name) => manager.stop(name)));
    await Promise.all([...this.running.values()]);
  }

  // Makes the copy while the twin is paused, then starts the run
  private async begin(body: ExecuteCommandDto): Promise<number> {
    const root = this.copies();
    this.refuseLive(body.name);
    const time = new Date().toISOString();
    const directory = join(root, snapshotName(time));
    const { snapshots, twin, fsm } = this.host;
    await snapshots.saveInto(directory, time, {
      record: false,
      stop: false,
      whatIf: (copy) => writePresent(copy, presentOf(twin, fsm)),
    });
    // a run that started during the copy, which no route guard stops;
    // from here to the start nothing awaits
    try {
      this.refuseLive(body.name);
    } catch (error) {
      await this.remove({ id: 0, name: body.name, directory });
      throw error;
    }
    return this.start(body, directory);
  }

  // A what-if does not join a live run of its command
  private refuseLive(name: string): void {
    if (this.host.fsm.manager.isRunning(name)) {
      throw conflict('command running');
    }
  }

  // The directory of the copies; the checks of a save come first, and a
  // what-if needs access control, as without it any process of the host
  // may call the API that the script is kept from
  private copies(): string {
    this.host.snapshots.checked();
    if (this.host.config.access() === undefined) {
      throw conflict('no access control');
    }
    return this.root() as string;
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
    this.running.set(name, this.follow(run, result));
    return id;
  }

  // However the run ends, the copy goes; then the listeners hear of it,
  // unless the shutdown stopped it
  private async follow(run: Run, result: Promise<CommandResult>) {
    let ended: WhatIfEndDto | undefined;
    try {
      ended = endOf(run, await result);
    } catch (error) {
      this.logger.error(`The what-if ${run.name} failed: ${error}`);
    } finally {
      await this.remove(run);
    }
    const data = ended;
    if (data !== undefined && !this.stopping) {
      this.listeners.forEach((listener) => listener(data));
    }
  }

  // A copy that can not be removed is logged; the next start removes it
  private async remove({ name, directory }: Run): Promise<void> {
    await rm(directory, { recursive: true, force: true }).catch((error) =>
      this.logger.error(`Could not remove the copy ${directory}: ${error}`),
    );
    this.asked.delete(name);
    this.running.delete(name);
  }
}
