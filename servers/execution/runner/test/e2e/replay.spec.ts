import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { readRows } from 'src/tools/inputs';
import {
  endedPair,
  Pair,
  replayFile,
  runningPair,
  tool,
  wardTwin,
} from './replay.util';

const TIMEOUT = 60000;

const built = existsSync('dist/src/tools/replay.js') ? describe : describe.skip;

const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

// The built tools against snapshots that a real runner saved; CI builds
// before it tests
built('runner-replay and runner-compare', () => {
  let ended: string;
  let running: string;
  let pairs: { ended: Pair; running: Pair };

  beforeAll(async () => {
    [ended, running] = [wardTwin(), wardTwin()];
    pairs = {
      ended: await endedPair(ended),
      running: await runningPair(running),
    };
  }, TIMEOUT);

  afterAll(() => {
    [ended, running].forEach((dir) =>
      rmSync(dir, { recursive: true, force: true }),
    );
  });

  const replay = async (dir: string, name: string, content: object) => {
    replayFile(dir, `${name}.yaml`, {
      out: `replays/${name}`,
      speed: 20,
      settle: 10,
      ...content,
    });
    return tool('replay', [`${name}.yaml`], dir);
  };

  it(
    'Should replay a twin whose script had ended, equal in its entries',
    async () => {
      const ran = await replay(ended, 'same', pairs.ended);
      const compared = await tool(
        'compare',
        [pairs.ended.inputs, 'replays/same'],
        ended,
      );
      const done = json(join(ended, 'replays/same/replay.json'));

      expect(ran).toMatchObject({ code: 0 });
      expect(ran.stdout).toContain('Sent 1 inputs, 0 refused');
      expect(done).toMatchObject({
        format: 1,
        of: 'dt-1',
        sent: 1,
        refused: 0,
        firstStep: null,
      });
      expect(compared.code).toBe(0);
      expect(compared.stdout).toMatch(/work +next/);
      expect(compared.stdout).toContain('entries: 2 and 2; the same');
    },
    TIMEOUT,
  );

  it(
    'Should stamp each row of the replay twin with its at',
    async () => {
      const { from } = json(join(ended, 'replays/same/replay.json'));
      const rows = readRows(join(ended, 'replays/same/state.db'), from.seq);

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every(({ at }) => at !== undefined)).toBe(true);
      expect(rows.find(({ kind }) => kind === 'event')).toMatchObject({
        by: 'replay',
        origin: { by: 'alice' },
      });
    },
    TIMEOUT,
  );

  it(
    'Should enter the saved state again when its script was running',
    async () => {
      const ran = await replay(running, 'again', pairs.running);
      const compared = await tool(
        'compare',
        [pairs.running.inputs, 'replays/again'],
        running,
      );
      const done = json(join(running, 'replays/again/replay.json'));
      const rows = readRows(
        join(running, 'replays/again/state.db'),
        done.from.seq,
      );

      expect(ran).toMatchObject({ code: 0 });
      expect(done.firstStep).toEqual(expect.any(Number));
      expect(rows.find(({ kind }) => kind === 'transition')).toMatchObject({
        data: { state: 'work' },
        by: 'replay',
      });
      expect(compared).toMatchObject({ code: 0 });
      expect(compared.stdout).toContain('entries: 1 and 1; the same');
    },
    TIMEOUT,
  );

  it(
    'Should mark the first difference of a replay with a changed parameter',
    async () => {
      const set = { parameters: { capacity: 3 } };
      const ran = await replay(ended, 'changed', { ...pairs.ended, set });
      const compared = await tool(
        'compare',
        [pairs.ended.inputs, 'replays/changed'],
        ended,
      );
      const asJson = await tool(
        'compare',
        [pairs.ended.inputs, 'replays/changed', '--json'],
        ended,
      );
      const config = readFileSync(
        join(ended, 'replays/changed/runner.yaml'),
        'utf8',
      );

      expect(ran).toMatchObject({ code: 0 });
      expect(config).toContain('capacity: 3');
      expect(compared.code).toBe(1);
      expect(compared.stdout).toMatch(
        /ok +valid +failed +invalid {3}<- first difference/,
      );
      expect(asJson.code).toBe(1);
      expect(JSON.parse(asJson.stdout)).toMatchObject({
        same: false,
        a: { entries: 2 },
      });
    },
    TIMEOUT,
  );

  it(
    'Should feed a replay twin the steps of a scenario',
    async () => {
      const { time } = json(join(ended, pairs.ended.start, 'snapshot.json'));
      const at = (ms: number) =>
        new Date(Date.parse(time) + ms).toISOString().replace(/[-:.]/g, '');
      const steps = [
        { at: at(20), event: 'unknown' },
        { at: at(10), event: 'next' },
      ];
      const file = {
        start: pairs.ended.start,
        out: 'replays/steps',
        speed: 20,
        settle: 10,
        steps,
      };
      replayFile(ended, 'steps.yaml', file);
      const dry = await tool('replay', ['steps.yaml', '--dry-run'], ended);
      const ran = await tool('replay', ['steps.yaml'], ended);
      const again = await tool('replay', ['steps.yaml', '--dry-run'], ended);
      const done = json(join(ended, 'replays/steps/replay.json'));

      expect(dry.code).toBe(0);
      expect(dry.stdout.trim().split('\n')).toEqual([
        `${at(10)} +0.001s event - POST /fsm/event {"event":"next"}`,
        `${at(20)} +0.001s event - POST /fsm/event {"event":"unknown"}`,
      ]);
      expect(ran).toMatchObject({ code: 0 });
      expect(done).toMatchObject({ inputs: null, sent: 2, refused: 1 });
      expect(again.code).toBe(2);
      expect(again.stderr).toContain('exists already');
    },
    TIMEOUT,
  );
});
