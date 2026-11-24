import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import Config from './config/configuration.service.js';
import { DescriptorDto } from './dto/descriptor.dto.js';
import { MetricsDto } from './dto/metrics.dto.js';
import type { Reinstated } from './dto/snapshot.dto.js';
import { commandState, StateDocumentDto } from './dto/state.dto.js';
import { EscalationListener } from './fsm/escalation.js';
import FsmService from './fsm/fsm.service.js';
import Metrics from './fsm/metrics.js';
import Properties from './fsm/properties.js';
import { ChangeListener } from './notify/changes.js';
import Peers from './peers/peers.js';
import Queue from './queue.service.js';
import Timeline from './queue.timeline.js';
import Snapshots from './snapshot/snapshots.js';

// Milliseconds since the epoch, on the monotonic clock of the process
const now = (): number => performance.timeOrigin + performance.now();

// Describes the digital twin that this runner serves, its state, and
// the metrics of what it did since the runner started
@Injectable()
export default class DescriptorService
  implements OnModuleInit, BeforeApplicationShutdown
{
  private readonly counters = new Metrics();

  // The peers of runner.yaml, which PeerWatch follows
  private readonly peerList = new Peers();

  // The latest values that scripts and sensors wrote
  private readonly propertyValues = new Properties();

  private readonly saves: Snapshots;

  // The snapshot that this start reinstated the twin from, if any
  private reinstated: Reinstated | undefined;

  constructor(
    private readonly config: Config,
    private readonly fsm: FsmService,
    private readonly queue: Queue,
  ) {
    this.saves = new Snapshots(config, fsm, queue);
    // registered first, so that the row of a notice comes before the
    // rows of the events that it raises
    this.peerList.onNotice((peer, kind, data) =>
      this.queue.timeline.record('notice', { peer, kind, data }, null),
    );
  }

  // Runs at init, after main.ts restored the machine, which is the
  // baseline of the metrics, and opened the database of the queue
  onModuleInit(): void {
    this.counters.start(this.fsm.check(), performance.timeOrigin);
    this.fsm.onChange(() => this.counters.observe(this.fsm.check(), now()));
    this.fsm.onAnswer((request, reply) =>
      this.counters.answered(request, reply),
    );
    this.fsm.onEscalation((data) => this.counters.escalated(data));
    this.peerList.load(this.config.getPeers(), this.queue);
    this.restoreProperties();
    this.recordStart();
  }

  // The first row of the timeline of this start: the class, what the
  // instance sets, and the whole state that the runner starts with
  private recordStart(): void {
    const { machine, parameters, properties } = this.state();
    const start = {
      class: this.fsm.declared()?.dtClass ?? null,
      instance: this.config.getParameters(),
      state: { machine, parameters, properties },
      peers: this.peerList.enabledIds(),
      ...(this.reinstated && { reinstated: this.reinstated }),
    };
    this.queue.timeline.record('start', start, null);
  }

  // Before init, so that the start row names the snapshot
  reinstatedFrom(snapshot: Reinstated): void {
    this.reinstated = snapshot;
  }

  // The database closes after this hook
  beforeApplicationShutdown(): void {
    this.queue.timeline.record('shutdown', {}, null);
  }

  timeline(): Timeline {
    return this.queue.timeline;
  }

  // A stored value that no longer fits its declaration is dropped
  private restoreProperties(): void {
    const declared = this.fsm.declared()?.properties;
    const dropped = this.propertyValues.load(declared, this.queue);
    if (dropped.length > 0) {
      new Logger(DescriptorService.name).warn(
        `Dropped the stored properties ${dropped.join(', ')}, which no longer fit their declarations`,
      );
    }
  }

  // The saves of the twin into snapshots
  snapshots(): Snapshots {
    return this.saves;
  }

  properties(): Properties {
    return this.propertyValues;
  }

  // Milliseconds between state notifications that differ in property
  // values only
  stateInterval(): number {
    return this.config.getStateInterval();
  }

  peers(): Peers {
    return this.peerList;
  }

  describe(): DescriptorDto {
    return {
      id: this.config.getId(),
      attributes: this.config.getAttributes(),
      commands: this.config.permitCommands(),
      class: this.fsm.declared()?.dtClass ?? null,
      stateMachine: this.fsm.check() !== undefined,
      manager: { commands: this.fsm.declared()?.managerCommands ?? [] },
      peers: this.peerList.enabledIds(),
      publicKey: this.config.getSigner().publicKey(),
    };
  }

  state(): StateDocumentDto {
    return {
      id: this.config.getId(),
      time: new Date().toISOString(),
      machine: this.fsm.check() ?? null,
      parameters: this.fsm.parameters()?.values() ?? {},
      properties: this.propertyValues.values(),
      command: commandState(this.queue.activeCommand()),
    };
  }

  metrics(): MetricsDto {
    return {
      since: new Date(performance.timeOrigin).toISOString(),
      uptime: Math.floor(process.uptime()),
      commands: this.queue.commandCounts(),
      resources: this.queue.resourceTotals(),
      ...this.counters.report(now()),
    };
  }

  // The state machine, the queue and the properties each signal a change
  // of the state document
  onChange(listener: ChangeListener): void {
    this.propertyValues.onChange(listener);
    this.fsm.onChange(listener);
    this.queue.onChange(listener);
  }

  onEscalation(listener: EscalationListener): void {
    this.fsm.onEscalation(listener);
  }
}
