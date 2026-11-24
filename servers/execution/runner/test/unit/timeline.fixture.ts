import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import Signer from 'src/auth/signer';
import Config from 'src/config/configuration.service';
import DescriptorService from 'src/descriptor.service';
import { callerContext } from 'src/auth/caller-context';
import { TimelineRow } from 'src/dto/timeline.dto';
import ExecaManager from 'src/execa-manager.service';
import FsmService from 'src/fsm/fsm.service';
import PeerEventsService from 'src/fsm/peer-events.service';
import { CommandOptions } from 'src/interfaces/command.interface';
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
    newCommand: (name: string, _key?: string, options?: CommandOptions) => {
      const id = queue.enqueue(name);
      options?.onRun?.(id);
      return new Promise((resolve) => {
        finishers.set(name, (outcome) => {
          finishers.delete(name);
          const result = [outcome, new Map(), 0, NO_RESOURCES] as const;
          options?.ended?.(outcome, id);
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
  const stop = async (name: string) => {
    await manager.stop(name);
    await settle();
  };
  return { manager, finish, stop };
}

function fakeConfig(file: string) {
  return {
    getId: () => 'hospital-1',
    getStateMachine: () => file,
    permitCommands: () => ['create', 'open', 'full', 'admit'],
    getParameters: () => ({ capacity: 30 }),
    getPeers: () => PEERS,
    getSnapshots: () => undefined,
    getScriptUser: () => undefined,
    getAttributes: () => ({}),
    getStateInterval: () => 0,
    getSigner: () => new Signer(undefined, 'hospital-1'),
  } as unknown as Config;
}

// The services of a runner, as Nest starts them, over a database in
// memory, a fake script manager and fake transports, which are
// configured unless the test says otherwise
export function startRunner(transports = true) {
  const enabled = () => transports;
  const dir = mkdtempSync(join(tmpdir(), 'timeline-'));
  writeFileSync(join(dir, 'machine.yaml'), DEFINITION);
  const config = fakeConfig(join(dir, 'machine.yaml'));
  const queue = new Queue();
  const { manager, finish, stop } = fakeManager(queue);
  const fsm = new FsmService(manager as unknown as ExecaManager, config, queue);
  fsm.load();
  fsm.restore();
  const descriptor = new DescriptorService(config, fsm, queue);
  const peerEvents = new PeerEventsService(fsm, descriptor);
  const connects: Array<() => void> = [];
  const onConnect = (listener: () => void) => connects.push(listener);
  const status = () => (transports ? 'connected' : 'disabled');
  const mqtt = { notify: jest.fn(), onConnect, status };
  const webhook = { post: jest.fn(), sendOnce: jest.fn(), enabled };
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
  return { dir, queue, fsm, descriptor, notifier, mqtt, finish, stop, connect };
}

// Every row of the timeline, oldest first
export const allRows = (queue: Queue): TimelineRow[] =>
  queue.timeline.rows({ after: 0, limit: 1000, count: false });

// The rows that are not sent notifications, which come with most of them
export const changes = (rows: TimelineRow[]) =>
  rows.filter(({ kind }) => kind !== 'sent');

type Runner = ReturnType<typeof startRunner>;

// Runs the act as the request of the principal would
export const as = <T>(by: string, act: () => T): T =>
  callerContext.run({ by }, act);

export const FULL = { id: 'hospital-2', machine: { state: 'full', entry: 4 } };

// A day of the hospital: a client starts it and its script completes; a
// manager widens its scope, which stops and restarts open; a full peer
// moves it to full while open runs on; open ends late and full is
// stopped; a sensor counts the beds twice, a client admits and stops,
// and it shuts down
export async function day(runner: Runner) {
  const { fsm, descriptor, queue, finish, stop } = runner;
  as('alice', () => fsm.transition('create'));
  await finish('create');
  as('manager-1', () => fsm.setParameters({ scope: 'multi' }));
  await settle();
  descriptor.peers().observe('hospital-2', 'state', FULL);
  await finish('open');
  await stop('full');
  as('alice', () => fsm.event('admit'));
  as('ward-gateway', () => descriptor.properties().set({ 'free-beds': 3 }));
  as('ward-gateway', () => descriptor.properties().set({ 'free-beds': 3 }));
  as('manager-1', () => descriptor.peers().set({ 'hospital-2': false }));
  const command = { name: 'admit', input: { patient: 'p-7' } };
  as('alice', () =>
    queue.timeline.command(command, (onRun) => onRun(queue.enqueue('admit'))),
  );
  as('alice', () => queue.timeline.record('stop', { name: null }));
  await descriptor.beforeApplicationShutdown();
}
