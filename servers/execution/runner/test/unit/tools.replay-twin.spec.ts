import { createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from '@jest/globals';
import { configSchema } from 'src/config/config.schema';
import { freePort, newKeyPair, replayConfig } from 'src/tools/replay-config';
import ReplayTwin from 'src/tools/replay-twin';
import type { SnapshotDir } from 'src/tools/snapshot-dir';
import { ToolError } from 'src/tools/tool-error';
import { newDir } from './tools.fixture';

// The copy of runner.yaml in a snapshot, with all that a twin may have
const COPY = {
  id: 'hospital-1',
  attributes: { ward: 'cardiology' },
  port: 5100,
  location: 'scripts',
  commands: ['open', 'admit'],
  stateMachine: 'fsm/hospital.fsm.yaml',
  database: 'run/hospital-1.db',
  parameters: { scope: 'single', beds: 4 },
  stopGrace: 500,
  mqtt: {
    url: 'mqtt://localhost:1883',
    topic: 'dtaas/hospital-1',
    password: '',
  },
  auth: {
    key: 'keys/hospital-1.key',
    principals: [{ name: 'alice', role: 'client', publicKey: 'x'.repeat(43) }],
  },
  relationships: {
    manager: { notify: { url: 'http://localhost:9000', token: '' } },
    peers: [
      {
        id: 'hospital-2',
        topic: 'dtaas/hospital-2',
        relationship: 'neighbour',
      },
    ],
  },
  scripts: { workdir: 'work' },
  snapshots: { directory: 'snapshots' },
};

const start = (copy: Record<string, unknown>): SnapshotDir => ({
  dir: '/srv/run/snapshots/20261122T220000000Z',
  manifest: { format: 1, id: 'hospital-1', class: null, time: '', seq: 1 },
  copy,
  stateMachine: '/srv/run/snapshots/20261122T220000000Z/hospital.fsm.yaml',
});

describe('The configuration of a replay twin', () => {
  const setup = {
    out: '/srv/replays/scope-multi',
    port: 41873,
    publicKey: 'k'.repeat(43),
  };

  it('Should reach nobody, keep the instance values and list one principal', () => {
    const config = replayConfig({
      ...setup,
      start: start(COPY),
      parameters: { scope: 'multi' },
    });

    expect(config).toEqual({
      id: 'hospital-1.replay',
      attributes: { ward: 'cardiology' },
      port: 41873,
      location: '../../run/snapshots/20261122T220000000Z/scripts',
      commands: ['open', 'admit'],
      stateMachine: '../../run/snapshots/20261122T220000000Z/hospital.fsm.yaml',
      database: 'state.db',
      parameters: { scope: 'multi', beds: 4 },
      stopGrace: 500,
      relationships: { peers: COPY.relationships.peers },
      auth: {
        principals: [
          { name: 'replay', role: 'operator', publicKey: setup.publicKey },
        ],
      },
    });
  });

  it('Should be a configuration that the runner reads', () => {
    const { publicKey } = newKeyPair();
    const config = replayConfig({ ...setup, publicKey, start: start(COPY) });

    expect(configSchema.safeParse(config).success).toBe(true);
  });

  it('Should leave out parameters and peers that the copy has not', () => {
    const { parameters, relationships, ...bare } = COPY;
    const config = replayConfig({
      ...setup,
      start: { ...start(bare), stateMachine: undefined },
    });

    expect(parameters).toBeDefined();
    expect(relationships).toBeDefined();
    expect(config).not.toHaveProperty('parameters');
    expect(config).not.toHaveProperty('stateMachine');
    expect(config.relationships).toEqual({ peers: [] });
  });

  it('Should make a key pair whose public key is that of runner.yaml', () => {
    const { privateKey, publicKey } = newKeyPair();
    const key = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: publicKey },
      format: 'jwk',
    });
    const data = Buffer.from('replay');

    expect(publicKey).toMatch(/^[\w-]{43}$/);
    expect(verify(null, data, key, sign(null, data, privateKey))).toBe(true);
  });

  it('Should find a free port', async () => {
    const port = await freePort();

    expect(port).toBeGreaterThan(0);
  });
});

describe('The runner of a replay twin', () => {
  const out = newDir();

  afterAll(() => rmSync(out, { recursive: true, force: true }));

  // Under ts-jest main.js is not built beside the tools, so the child
  // ends at once, as a runner that refuses its configuration does
  it('Should stop with the last lines of the log when the runner does not come up', async () => {
    const twin = new ReplayTwin(out, await freePort());
    twin.start(out, 10);
    const failed = await twin.ready().catch((error: ToolError) => error);
    await twin.stop();
    twin.kill();

    expect(failed).toBeInstanceOf(ToolError);
    expect(failed).toMatchObject({
      code: 1,
      message: expect.stringContaining('did not come up'),
    });
    expect(readFileSync(join(out, 'runner.log'), 'utf8')).toContain('main.js');
    expect(twin.url('/fsm')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/fsm$/);
  });

  it('Should give up after the time given', async () => {
    const twin = new ReplayTwin(out, await freePort());
    const failed = await twin.ready(0).catch((error: ToolError) => error);
    await twin.stop();

    expect(failed).toMatchObject({ code: 1 });
  });
});
