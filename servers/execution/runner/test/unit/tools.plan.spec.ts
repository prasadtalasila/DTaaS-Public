import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, jest } from '@jest/globals';
import * as yaml from 'js-yaml';
import { readReplayFile } from 'src/tools/replay-file';
import { prepare } from 'src/tools/replay-plan';
import { dryLine, replay, summary } from 'src/tools/replay-run';
import { ToolError } from 'src/tools/tool-error';
import { fakeSnapshot, newDir, Row } from './tools.fixture';

const START = '2026-11-22T22:00:00.000Z';

// Rows after the start at seq 2: what entered the twin and what did not
const ROWS: Row[] = [
  { kind: 'start', data: {} },
  { kind: 'entry', data: { state: 'idle' } },
  {
    kind: 'event',
    data: { event: 'next', source: 'client' },
    by: 'alice',
    time: '2026-11-22T22:10:00.000Z',
  },
  {
    kind: 'properties',
    data: { beds: 1 },
    by: 'script',
    time: '2026-11-22T22:15:00.000Z',
  },
  {
    kind: 'properties',
    data: { beds: 2 },
    by: 'feed',
    time: '2026-11-22T22:20:00.000Z',
  },
  {
    kind: 'transition',
    data: { state: 'idle' },
    by: 'alice',
    time: '2026-11-23T05:00:00.000Z',
  },
  {
    kind: 'transition',
    data: { state: 'late' },
    by: 'alice',
    time: '2026-11-23T07:00:00.000Z',
  },
];

const AUTH = {
  principals: [
    { name: 'alice', role: 'client', publicKey: 'a'.repeat(43) },
    { name: 'feed', role: 'sensor', publicKey: 'b'.repeat(43) },
  ],
};

describe('A replay file and its snapshots', () => {
  const dir = newDir();
  const config = {
    id: 'dt-1',
    port: 1,
    location: 'scripts',
    commands: [],
    stateMachine: 'ward.fsm.yaml',
    auth: AUTH,
  };
  fakeSnapshot(dir, 'start', { time: START, seq: 2 });
  fakeSnapshot(dir, 'inputs', {
    time: '2026-11-23T06:00:00.000Z',
    seq: 6,
    rows: ROWS,
    config,
  });

  const file = (content: object, name = 'replay.yaml') => {
    writeFileSync(join(dir, name), yaml.dump(content));
    return join(dir, name);
  };

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('Should resolve the paths against the file, with the defaults', () => {
    mkdirSync(join(dir, 'sub'), { recursive: true });
    const plan = readReplayFile(
      file(
        { start: '../start', inputs: '../inputs', out: 'out' },
        'sub/r.yaml',
      ),
    );

    expect(plan).toMatchObject({
      start: join(dir, 'start'),
      inputs: join(dir, 'inputs'),
      out: join(dir, 'sub', 'out'),
      speed: 1,
      settle: 30,
    });
  });

  it('Should refuse an out that exists, and a step before the start', async () => {
    const steps = [{ at: '20261122T215959999Z', event: 'next' }];
    const early = readReplayFile(file({ start: 'start', steps, out: 'o' }));

    expect(early.inputs).toBeUndefined();
    expect(() =>
      readReplayFile(file({ start: 'start', steps, out: 'start' })),
    ).toThrow('exists already');
    await expect(prepare(early)).rejects.toMatchObject({
      code: 2,
      message: expect.stringContaining('steps.0.at'),
    });
  });

  it('Should refuse the inputs of a twin without principals', async () => {
    fakeSnapshot(dir, 'open', {
      time: '2026-11-23T06:00:00.000Z',
      seq: 6,
      rows: ROWS,
    });
    const plan = readReplayFile(
      file({ start: 'start', inputs: 'open', out: 'o' }),
    );

    await expect(prepare(plan)).rejects.toMatchObject({
      code: 2,
      message: expect.stringContaining('lists no auth.principals'),
    });
  });

  it('Should refuse a file that is no YAML', () => {
    writeFileSync(join(dir, 'bad.yaml'), 'start: [');

    expect(() => readReplayFile(join(dir, 'bad.yaml'))).toThrow(ToolError);
  });

  it('Should send what entered the twin up to the inputs snapshot', async () => {
    const prepared = await prepare(
      readReplayFile(file({ start: 'start', inputs: 'inputs', out: 'o' })),
    );

    expect(prepared.inputs.map(({ seq, kind, by }) => [seq, kind, by])).toEqual(
      [
        [3, 'event', 'alice'],
        [5, 'properties', 'feed'],
        [6, 'transition', 'alice'],
      ],
    );
    expect(prepared.until).toEqual({
      seq: 6,
      time: '2026-11-23T06:00:00.000Z',
    });
  });

  it('Should stop at the last input before until', async () => {
    const plan = readReplayFile(
      file({
        start: 'start',
        inputs: 'inputs',
        out: 'o',
        until: '20261122T221800000Z',
      }),
    );
    const prepared = await prepare(plan);

    expect(prepared.inputs.map(({ seq }) => seq)).toEqual([3]);
    expect(prepared.until).toEqual({
      seq: 4,
      time: '2026-11-22T22:18:00.000Z',
    });
  });

  it('Should take the steps of a scenario', async () => {
    const steps = [{ at: '20261122T221000000Z', transition: 'idle' }];
    const prepared = await prepare(
      readReplayFile(
        file({ start: 'start', steps, out: 'o', until: '20261123T000000000Z' }),
      ),
    );

    expect(prepared.inputs).toHaveLength(1);
    expect(prepared.until).toEqual({
      seq: null,
      time: '2026-11-23T00:00:00.000Z',
    });
  });

  it('Should print one line for each input in a dry run, and start nothing', async () => {
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const code = await replay(
      file({ start: 'start', inputs: 'inputs', out: 'o', speed: 60 }),
      true,
    );
    const lines = write.mock.calls.map(([text]) => String(text));
    write.mockRestore();

    expect(code).toBe(0);
    expect(lines).toEqual([
      '20261122T221000000Z +10.000s event alice POST /fsm/event {"event":"next"}\n',
      '20261122T222000000Z +20.000s properties feed PUT /properties {"beds":2}\n',
      '20261123T050000000Z +420.000s transition alice POST /fsm/transition {"state":"idle"}\n',
    ]);
  });

  it('Should say what a replay did, in the format of replay.json', async () => {
    const plan = readReplayFile(
      file({
        start: 'start',
        inputs: 'inputs',
        out: 'o',
        set: { parameters: { scope: 'multi' } },
      }),
    );
    const prepared = await prepare(plan);
    const done = summary(plan, prepared, {
      sent: 3,
      refused: 1,
      firstStep: null,
    });

    expect(done).toEqual({
      format: 1,
      of: 'dt-1',
      start: join(dir, 'start'),
      inputs: join(dir, 'inputs'),
      from: { seq: 2, time: START },
      until: { seq: 6, time: '2026-11-23T06:00:00.000Z' },
      speed: 1,
      set: { parameters: { scope: 'multi' } },
      sent: 3,
      refused: 1,
      firstStep: null,
    });
    expect(dryLine({ ...prepared.inputs[0], by: null }, START, 1)).toContain(
      ' event - POST',
    );
  });
});
