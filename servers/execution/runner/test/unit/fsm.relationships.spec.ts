import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import Config from 'src/config/configuration.service';
import { parseDefinition } from 'src/fsm/definition';
import { loadDefinition } from 'src/fsm/load';
import {
  bind,
  known,
  PeerEvents,
  Subscription,
  unbound,
} from 'src/fsm/subscriptions';

const HEAD = `
events: [neighbour-full, neighbour-down]
states:
  open:
    transitions:
      neighbour-full: {state: open, stop: true}
`;

const CLASS = `${HEAD}subscriptions:
  - relationship: neighbour
    when: {state: full}
    event: neighbour-full
  - relationship: supplier
    when: {online: false}
    event: neighbour-down
`;

const base = { commands: ['open'], peers: ['hospital-2', 'hospital-3'] };

const parse = (text: string) => parseDefinition(text, 'dt.yaml', base);

const full: Subscription = {
  relationship: 'neighbour',
  when: { state: 'full' },
  event: 'neighbour-full',
};

const FULL = { id: 'x', machine: { state: 'full' } };

describe('Subscriptions to a relationship', () => {
  it('Should read a subscription that names a relationship', () => {
    expect(parse(CLASS).subscriptions[0]).toEqual(full);
  });

  it.each([
    [
      'both a peer and a relationship',
      'peer: hospital-2\n    relationship: neighbour',
    ],
    ['neither a peer nor a relationship', 'event: neighbour-full'],
    ['a relationship that is no name', 'relationship: ../neighbour'],
  ])('Should refuse %s', (_, lines) => {
    const text = `${HEAD}subscriptions:\n  - ${lines}\n    when: {state: full}\n    event: neighbour-full\n`;

    expect(() => parse(text)).toThrow(/subscriptions/);
  });

  it('Should name the relationship in the problems of a subscription', () => {
    const entry =
      '  - {relationship: neighbour, when: {state: full}, event: other}\n';
    const twice = `${CLASS}  - {relationship: neighbour, when: {state: full}, event: neighbour-full}\n`;

    expect(() => parse(`${HEAD}subscriptions:\n${entry}`)).toThrow(
      'subscription to relationship neighbour raises undeclared event other',
    );
    expect(() => parse(twice)).toThrow(
      'subscription to relationship neighbour repeats neighbour-full on state full',
    );
  });

  it('Should need no listed peer for a relationship', () => {
    expect(
      parseDefinition(CLASS, 'dt.yaml', { ...base, peers: [] }).subscriptions,
    ).toHaveLength(2);
  });
});

describe('Peers bound to a relationship', () => {
  it('Should follow every peer of the relationship', () => {
    const bound = { neighbour: ['hospital-2', 'hospital-3'] };

    expect(bind([full], bound)).toEqual([
      { ...full, peer: 'hospital-2' },
      { ...full, peer: 'hospital-3' },
    ]);
  });

  it('Should follow no peer for a relationship that none has', () => {
    expect(bind([full], {})).toEqual([]);
    expect(bind([full], { supplier: ['hospital-2'] })).toEqual([]);
  });

  it('Should keep a subscription that names a peer', () => {
    const named = {
      peer: 'hospital-2',
      when: { online: false },
      event: 'neighbour-down',
    };

    expect(bind([named], {})).toEqual([named]);
  });

  it('Should follow once a peer that is reached twice', () => {
    const named = { peer: 'hospital-2', when: full.when, event: full.event };

    expect(bind([named, full], { neighbour: ['hospital-2'] })).toEqual([named]);
  });

  it('Should list the relationships that no peer has, once each', () => {
    const subscriptions = parse(
      `${CLASS}  - {relationship: supplier, when: {state: full}, event: neighbour-full}\n`,
    ).subscriptions;

    expect(unbound(subscriptions, { neighbour: ['hospital-2'] })).toEqual([
      'supplier',
    ]);
    expect(unbound(subscriptions, {})).toEqual(['neighbour', 'supplier']);
  });

  it('Should take the relationships from the peers of runner.yaml', () => {
    const config = {
      permitCommands: () => ['open'],
      getScriptUser: () => undefined,
      getParameters: () => ({}),
      getPeers: () => [
        { id: 'hospital-2', relationship: 'neighbour' },
        { id: 'hospital-3', relationship: 'neighbour' },
        { id: 'depot-1', relationship: 'supplier' },
        { id: 'hospital-4' },
      ],
    } as unknown as Config;

    expect(known(config).relationships).toEqual({
      neighbour: ['hospital-2', 'hospital-3'],
      supplier: ['depot-1'],
    });
  });
});

describe('Instance of a class with relationships', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-relationships-'));
    file = join(dir, 'dt.yaml');
    writeFileSync(file, CLASS);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('Should raise the event of a relationship for each of its peers', () => {
    const relationships = { neighbour: ['hospital-2', 'hospital-3'] };
    const definition = loadDefinition(file, { ...base, relationships });
    const raised: (string | undefined)[] = [];
    const events = new PeerEvents(({ peer }) => raised.push(peer));
    events.declare(definition?.subscriptions ?? []);
    events.see('hospital-2', 'state', FULL);
    events.see('hospital-2', 'state', FULL);
    events.see('hospital-3', 'state', FULL);
    events.see('hospital-4', 'state', FULL);

    expect(raised).toEqual(['hospital-2', 'hospital-3']);
  });

  it('Should log the relationships that are idle in this instance', () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});
    const definition = loadDefinition(file, {
      ...base,
      relationships: { neighbour: ['hospital-2'] },
    });

    expect(definition?.subscriptions.map(({ peer }) => peer)).toEqual([
      'hospital-2',
    ]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(
      /no peer of runner.yaml has the relationship supplier/,
    );
  });

  it('Should log nothing when every relationship has a peer', () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});
    loadDefinition(file, {
      ...base,
      relationships: { neighbour: ['hospital-2'], supplier: ['hospital-3'] },
    });

    expect(log).not.toHaveBeenCalled();
  });

  it('Should follow no one without relationships in runner.yaml', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    expect(loadDefinition(file, base)?.subscriptions).toEqual([]);
  });
});
