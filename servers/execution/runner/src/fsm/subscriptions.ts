import { z } from 'zod';
import type Config from '../config/configuration.service.js';
import type { NoticeKind } from '../peers/peers.js';
import type { InstanceValues } from './class.js';
import { nameSchema } from './name.js';

// The ids of the peers that runner.yaml gives each relationship
export type Bound = Record<string, string[]>;

// What a definition is checked against: the commands that runner.yaml
// permits, the ids of the peers it lists, whether the scripts run as a
// second account, and what it sets for this instance: the values of
// parameters and the peers of each relationship
export type Known = {
  commands: string[];
  peers: string[];
  separated?: boolean;
  parameters?: InstanceValues;
  relationships?: Bound;
};

type Related = { id: string; relationship?: string };

const boundPeers = (peers: Related[]): Bound =>
  Object.fromEntries(
    peers
      .filter(({ relationship }) => relationship !== undefined)
      .map(({ relationship }) => [
        relationship,
        peers
          .filter((peer) => peer.relationship === relationship)
          .map(({ id }) => id),
      ]),
  );

export const known = (config: Config): Known => ({
  commands: config.permitCommands(),
  peers: config.getPeers().map(({ id }) => id),
  separated: config.getScriptUser() !== undefined,
  parameters: config.getParameters(),
  relationships: boundPeers(config.getPeers()),
});

// Exactly one condition on the latest notice of a peer
const whenSchema = z.union(
  [
    z.strictObject({ state: nameSchema }),
    z.strictObject({ online: z.boolean() }),
  ],
  { error: 'must hold exactly one of state: <name> and online: <boolean>' },
);

export type When = z.infer<typeof whenSchema>;

// A subscription names one peer by its id, or a relationship, which
// each instance binds to peers in runner.yaml; a class that several
// instances share can name no id
const subscriptionSchema = z
  .strictObject({
    peer: nameSchema.optional(),
    relationship: nameSchema.optional(),
    when: whenSchema,
    event: nameSchema,
  })
  .refine(
    ({ peer, relationship }) =>
      (peer === undefined) !== (relationship === undefined),
    'must name a peer or a relationship, and not both',
  );

export type Subscription = z.infer<typeof subscriptionSchema>;

// The subscriptions section of the state machine file
export const subscriptionsSchema = z.array(subscriptionSchema).default([]);

// A condition as the error messages and the log name it
export function condition(when: When): string {
  if ('state' in when) {
    return `state ${when.state}`;
  }
  return `online ${when.online}`;
}

const keyOf = ({ peer, relationship, when, event }: Subscription): string =>
  JSON.stringify([peer, relationship, condition(when), event]);

const label = ({ peer, relationship }: Subscription): string =>
  peer === undefined
    ? `subscription to relationship ${relationship}`
    : `subscription to peer ${peer}`;

// The subscriptions of one instance: each that names a relationship
// becomes one for every peer that runner.yaml gives the relationship,
// and none without such a peer. A peer reached twice is followed once.
export function bind(
  subscriptions: Subscription[],
  bound: Bound,
): Subscription[] {
  const each = subscriptions.flatMap((subscription) => {
    const { peer, relationship = '' } = subscription;
    const peers = peer === undefined ? (bound[relationship] ?? []) : [peer];
    return peers.map((id) => ({ ...subscription, peer: id }));
  });
  const keys = each.map(({ peer, when, event }) =>
    JSON.stringify([peer, condition(when), event]),
  );
  return each.filter((_, index) => keys.indexOf(keys[index]) === index);
}

// The relationships of the subscriptions that no peer has
export const unbound = (
  subscriptions: Subscription[],
  bound: Bound,
): string[] => [
  ...new Set(
    subscriptions
      .flatMap(({ relationship }) => relationship ?? [])
      .filter((relationship) => !Object.hasOwn(bound, relationship)),
  ),
];

type Section = { events: ReadonlySet<string>; subscriptions: Subscription[] };

// The problems of the subscriptions that their schema can not see
export function subscriptionProblems(
  { events, subscriptions }: Section,
  peers: string[],
): string[] {
  const keys = subscriptions.map(keyOf);
  const unlisted = subscriptions
    .flatMap(({ peer }) => peer ?? [])
    .filter((peer) => !peers.includes(peer))
    .map((peer) => `subscription to unlisted peer ${peer}`);
  const undeclared = subscriptions
    .filter(({ event }) => !events.has(event))
    .map((each) => `${label(each)} raises undeclared event ${each.event}`);
  const repeated = subscriptions
    .filter((each, index) => keys.indexOf(keyOf(each)) < index)
    .map(
      (each) =>
        `${label(each)} repeats ${each.event} on ${condition(each.when)}`,
    );
  return [...unlisted, ...undeclared, ...repeated];
}

// The state of a state document, if it has a machine
const documentSchema = z.object({ machine: z.object({ state: z.string() }) });

// The online of a presence notice, if it has one
const presenceSchema = z.object({ online: z.boolean() });

function stateHolds(state: string, kind: NoticeKind, data: unknown) {
  if (kind !== 'state') {
    return undefined;
  }
  return documentSchema.safeParse(data).data?.machine.state === state;
}

function onlineHolds(online: boolean, kind: NoticeKind, data: unknown) {
  if (kind !== 'presence') {
    return undefined;
  }
  return presenceSchema.safeParse(data).data?.online === online;
}

// Whether the condition holds in the notice, or undefined for a notice
// of the other kind, which says nothing about it. The null data of an
// empty payload holds nothing.
export function holds(
  when: When,
  kind: NoticeKind,
  data: unknown,
): boolean | undefined {
  if ('state' in when) {
    return stateHolds(when.state, kind, data);
  }
  return onlineHolds(when.online, kind, data);
}

export type Raise = (subscription: Subscription) => void;

// Raises the event of a subscription when its condition turns from not
// holding, or unknown, to holding, in the notices of its peer
export class PeerEvents {
  private subscriptions: Subscription[] = [];

  // Whether the condition of each subscription, by index, held in the
  // last notice of its kind; a missing index is unknown
  private readonly held = new Map<number, boolean>();

  constructor(private readonly raise: Raise) {}

  // A new load starts from unknown
  declare(subscriptions: Subscription[]): void {
    this.subscriptions = subscriptions;
    this.held.clear();
  }

  // Raises in file order, each against the state the previous one left
  see(peer: string, kind: NoticeKind, data: unknown): void {
    this.indexesOf(peer).forEach((index) => this.update(index, kind, data));
  }

  // Takes a notice as seen without raising: what held before this start
  know(peer: string, kind: NoticeKind, data: unknown): void {
    this.indexesOf(peer).forEach((index) => {
      const now = holds(this.subscriptions[index].when, kind, data);
      if (now !== undefined) {
        this.held.set(index, now);
      }
    });
  }

  // The next notice of the peer counts as its first
  forget(peer: string): void {
    this.indexesOf(peer).forEach((index) => this.held.delete(index));
  }

  private indexesOf(peer: string): number[] {
    return this.subscriptions.flatMap((each, index) =>
      each.peer === peer ? [index] : [],
    );
  }

  private update(index: number, kind: NoticeKind, data: unknown): void {
    const subscription = this.subscriptions[index];
    const now = holds(subscription.when, kind, data);
    if (now === undefined) {
      return;
    }
    const before = this.held.get(index);
    this.held.set(index, now);
    if (now && before !== true) {
      this.raise(subscription);
    }
  }
}
