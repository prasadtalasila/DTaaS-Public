import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { endedPair, Pair, replayFile, tool, wardTwin } from './replay.util';

const TIMEOUT = 60000;

const built = existsSync('dist/src/tools/replay.js') ? describe : describe.skip;

// Each refusal of the built tools, with exit code 2 and the cause named,
// before anything starts
built('runner-replay and runner-compare refuse', () => {
  let dir: string;
  let pair: Pair;

  beforeAll(async () => {
    dir = wardTwin();
    pair = await endedPair(dir);
  }, TIMEOUT);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const refused = async (content: object) => {
    replayFile(dir, 'refused.yaml', content);
    return tool('replay', ['refused.yaml'], dir);
  };

  // Exit code 2, with the cause in the error output
  const refusal = (cause: string) => ({
    code: 2,
    stderr: expect.stringContaining(cause),
  });

  // A copy of a snapshot, changed by the function given
  const changedCopy = (
    from: string,
    name: string,
    change: (copy: string) => void,
  ) => {
    const copy = join(dir, name);
    cpSync(join(dir, from), copy, { recursive: true });
    change(copy);
    return name;
  };

  it('Should refuse a missing or an unknown key', async () => {
    expect(
      await refused({ start: pair.start, inputs: pair.inputs }),
    ).toMatchObject(refusal('at out'));
    expect(await refused({ ...pair, out: 'x', speeed: 2 })).toMatchObject(
      refusal('speeed'),
    );
  });

  it('Should refuse inputs and steps together, or neither', async () => {
    const steps = [{ at: '20261124T000000000Z', event: 'next' }];
    expect(await refused({ ...pair, out: 'x', steps })).toMatchObject(
      refusal('give inputs or steps'),
    );
    expect(await refused({ start: pair.start, out: 'x' })).toMatchObject(
      refusal('at inputs'),
    );
  });

  it('Should refuse a time in another form, and a step with two inputs', async () => {
    expect(
      await refused({ ...pair, out: 'x', until: '2026-11-24T00:00:00.000Z' }),
    ).toMatchObject(refusal('at until'));
    expect(
      await refused({ ...pair, out: 'x', until: '20261332T000000000Z' }),
    ).toMatchObject(refusal('YYYYMMDDTHHMMSSmmmZ'));
    const steps = [
      { at: '20261124T000000000Z', event: 'next', transition: 'idle' },
    ];
    expect(await refused({ start: pair.start, out: 'x', steps })).toMatchObject(
      refusal('exactly one of'),
    );
  });

  it('Should refuse an out that exists', async () => {
    mkdirSync(join(dir, 'taken'));
    expect(await refused({ ...pair, out: 'taken' })).toMatchObject(
      refusal('exists already'),
    );
  });

  it('Should refuse a start or inputs that is no snapshot', async () => {
    expect(
      await refused({ ...pair, start: 'scripts', out: 'x' }),
    ).toMatchObject(refusal('start: '));
    expect(
      await refused({ ...pair, inputs: 'scripts', out: 'x' }),
    ).toMatchObject(refusal('inputs: '));
  });

  it('Should refuse snapshots of two twins, or inputs before the start', async () => {
    const other = changedCopy(pair.inputs, 'other', (copy) => {
      const file = join(copy, 'snapshot.json');
      const manifest = JSON.parse(readFileSync(file, 'utf8'));
      writeFileSync(file, JSON.stringify({ ...manifest, id: 'dt-2' }));
    });
    expect(
      await refused({ start: pair.start, inputs: other, out: 'x' }),
    ).toMatchObject(refusal('two twins'));
    expect(
      await refused({ start: pair.inputs, inputs: pair.start, out: 'x' }),
    ).toMatchObject(refusal('is not later than start'));
  });

  it('Should refuse a class without whatIf.replay', async () => {
    const plain = changedCopy(pair.start, 'plain', (copy) => {
      const file = join(copy, 'ward.fsm.yaml');
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replace('replay: true', 'replay: false'),
      );
    });
    expect(await refused({ ...pair, start: plain, out: 'x' })).toMatchObject(
      refusal('whatIf.replay: true'),
    );
  });

  it('Should refuse a step before the start', async () => {
    const steps = [{ at: '20200101T000000000Z', event: 'next' }];
    expect(await refused({ start: pair.start, out: 'x', steps })).toMatchObject(
      refusal('steps.0.at'),
    );
  });

  it('Should refuse a missing file and an unknown flag', async () => {
    const missing = await tool('replay', [], dir);
    const flag = await tool('replay', ['--speed', '2'], dir);

    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('runner-replay.yaml');
    expect(flag.code).toBe(2);
  });

  it('Should refuse to compare a directory that is neither', async () => {
    const ran = await tool('compare', [pair.inputs, 'scripts'], dir);

    expect(ran.code).toBe(2);
    expect(ran.stderr).toContain(
      'scripts is neither a snapshot nor the out of a replay',
    );
  });
});
