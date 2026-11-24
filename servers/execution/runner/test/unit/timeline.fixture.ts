import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import Signer from 'src/auth/signer';
import Config from 'src/config/configuration.service';
import DescriptorService from 'src/descriptor.service';
import { TimelineRow } from 'src/dto/timeline.dto';
import ExecaManager from 'src/execa-manager.service';
import FsmService from 'src/fsm/fsm.service';
import PeerEventsService from 'src/fsm/peer-events.service';
import { RunOutcome } from 'src/interfaces/runner.interface';
import MqttService from 'src/mqtt/mqtt.service';
import Notifier from 'src/notify/notifier.service';
import WebhookClient from 'src/notify/webhook.client';
import Queue from 'src/queue.service';
import { NO_RESOURCES } from 'src/resources/resources';
import { PEERS } from './fsm.fixture';

// A hospital whose admissions fill it: a peer that fills sends its
// patients here, and a change of scope restarts the open state
export const DEFINITION = `
events: [admit, neighbour-full, scope-changed]
parameters:
  scope: {type: string, enum: [single, multi], default: single, controllable: true, event: scope-changed}
  capacity: {type: number, default: 20}
properties:
  free-beds: {type: integer, minimum: 0, unit: beds}
states:
  create: {transitions: {$success: open}}
  open:
    transitions:
      admit: full
      neighbour-full: full
      scope-changed: {state: open, stop: true}
  full: {}
subscriptions:
  - {peer: hospital-2, when: {state: full}, event: neighbour-full}`;

export const settle = () => new Promise(setImmediate);

// Runs each script until the test finishes it, and keeps its run in the
// command history of the queue, as ExecaManager does
function fakeManager(queue: Queue) {
  const finishers = new Map<string, (outcome: RunOutcome) => void>();
  const manager = {
    isRunning: (name: string) => finishers.has(name),
    newCommand: (name: string) => {
      const id = queue.enqueue(name);
      return new Promise((resolve) => {
        finishers.set(name, (outcome) => {
          finishers.delete(name);
          const result = [outcome, new Map(), 0, NO_RESOURCES] as const;
          queue.complete(id, [...result]);
          resolve(result);
        });
      });
    },
    stop: (name: string) => {
      finishers.get(name)?.('stopped');
      return Promise.resolve([name]);
    },
  };
  const finish = async (name: string) => {
    finishers.get(name)?.('success');
    await settle();
  };
  return { manager, finish };
}

function fakeConfig(file: string) {
  return {
    getId: () => 'hospital-1',
    getStateMachine: () => file,
    permitCommands: () => ['create', 'open', 'full', 'admit'],
    getParameters: () => ({ capacity: 30 }),
    getPeers: () => PEERS,
    getScriptUser: () => undefined,
    getAttributes: () => ({}),
    getStateInterval: () => 0,
    getSigner: () => new Signer(undefined, 'hospital-1'),
  } as unknown as Config;
}

// The services of a runner, as Nest starts them, over a database in
// memory, a fake script manager and fake transports
export function startRunner(definition = DEFINITION) {
  const dir = mkdtempSync(join(tmpdir(), 'timeline-'));
  writeFileSync(join(dir, 'machine.yaml'), definition);
  const config = fakeConfig(join(dir, 'machine.yaml'));
  const queue = new Queue();
  const { manager, finish } = fakeManager(queue);
  const fsm = new FsmService(manager as unknown as ExecaManager, config, queue);
  fsm.load();
  fsm.restore();
  const descriptor = new DescriptorService(config, fsm, queue);
  const peerEvents = new PeerEventsService(fsm, descriptor);
  const connects: Array<() => void> = [];
  const onConnect = (listener: () => void) => connects.push(listener);
  const mqtt = { notify: jest.fn(), onConnect };
  const webhook = { post: jest.fn(), sendOnce: jest.fn() };
  const notifier = new Notifier(
    descriptor,
    mqtt as unknown as MqttService,
    webhook as unknown as WebhookClient,
  );
  descriptor.onModuleInit();
  notifier.onModuleInit();
  peerEvents.onModuleInit();
  notifier.onApplicationBootstrap();
  const connect = () => connects.forEach((listener) => listener());
  return { dir, queue, fsm, descriptor, notifier, finish, connect };
}

// Every row of the timeline, oldest first
export const allRows = (queue: Queue): TimelineRow[] =>
  queue.timeline.rows({ after: 0, limit: 1000, count: false });

// The rows that are not sent notifications, which come with most of them
export const changes = (rows: TimelineRow[]) =>
  rows.filter(({ kind }) => kind !== 'sent');
