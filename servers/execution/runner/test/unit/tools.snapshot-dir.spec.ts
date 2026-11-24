import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from '@jest/globals';
import { checkPair, checkReplay, readSnapshot } from 'src/tools/snapshot-dir';
import { fakeSnapshot, newDir } from './tools.fixture';

const TIME = '2026-11-22T22:00:00.000Z';

describe('The snapshots of a replay', () => {
  const dir = newDir();

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const read = (name: string, fake: Parameters<typeof fakeSnapshot>[2]) =>
    readSnapshot('start', fakeSnapshot(dir, name, fake));

  it('Should read the manifest, the copy and the class', async () => {
    const machine = { state: 'open', entry: 3, status: 'running' };
    const snapshot = await read('a', { time: TIME, seq: 4, machine });

    expect(snapshot.manifest).toMatchObject({
      id: 'dt-1',
      seq: 4,
      machine: { state: 'open', status: 'running' },
    });
    expect(snapshot.copy.id).toBe('dt-1');
    expect(snapshot.stateMachine).toBe(join(dir, 'a', 'ward.fsm.yaml'));
    expect(() => checkReplay(snapshot)).not.toThrow();
  });

  it('Should read a twin without a state machine file', async () => {
    const bare = fakeSnapshot(dir, 'bare', {
      time: TIME,
      seq: 1,
      config: { id: 'dt-1' },
    });
    const empty = fakeSnapshot(dir, 'empty', { time: TIME, seq: 1 });
    writeFileSync(join(empty, 'runner.yaml'), '');

    expect((await readSnapshot('start', bare)).stateMachine).toBeUndefined();
    await expect(readSnapshot('start', empty)).rejects.toMatchObject({
      code: 2,
    });
  });

  it('Should refuse a directory that is no snapshot, naming the key', async () => {
    await expect(
      readSnapshot('inputs', join(dir, 'none')),
    ).rejects.toMatchObject({
      code: 2,
      message: expect.stringMatching(/^inputs: .* is no snapshot/),
    });
  });

  it('Should refuse snapshots of two twins, and inputs that are not later', async () => {
    const start = await read('b', { time: TIME, seq: 4 });
    const other = await read('c', { id: 'dt-2', time: TIME, seq: 9 });
    const earlier = await read('d', { time: TIME, seq: 4 });

    expect(() => checkPair(start, other)).toThrow(
      'start and inputs are snapshots of two twins: dt-1 of class urn:dtaas:ward, and dt-2 of class urn:dtaas:ward',
    );
    expect(() => checkPair(start, earlier)).toThrow('its seq 4 is not above 4');
  });

  it('Should refuse a class without whatIf.replay, or no class', async () => {
    const plain = await read('e', { time: TIME, seq: 4 });
    writeFileSync(join(dir, 'e', 'ward.fsm.yaml'), 'states:\n  idle:\n');
    const none = { ...plain, stateMachine: undefined };
    const missing = { ...plain, stateMachine: join(dir, 'missing.yaml') };

    [plain, none, missing].forEach((snapshot) =>
      expect(() => checkReplay(snapshot)).toThrow('has no whatIf.replay: true'),
    );
  });
});
