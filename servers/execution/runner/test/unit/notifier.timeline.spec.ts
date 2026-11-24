import { rmSync } from 'node:fs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Logger } from '@nestjs/common';
import { NotificationDto } from 'src/dto/notify.dto';
import { StateDocumentDto } from 'src/dto/state.dto';
import { TimelineRow } from 'src/dto/timeline.dto';
import { allRows, as, day, startRunner } from './timeline.fixture';

type Runner = ReturnType<typeof startRunner>;

const isState = ({ kind, data }: TimelineRow) =>
  kind === 'sent' && data.kind === 'state';

// The state documents that went out over MQTT, in order
const documents = ({ mqtt }: Runner) =>
  mqtt.notify.mock.calls
    .filter(([kind]) => kind === 'state')
    .map(([, notification]) => (notification as NotificationDto).data)
    .map((data) => data as StateDocumentDto);

describe('Timeline of what a runner sends', () => {
  let runner: Runner;

  // the peer events that the day raises are logged
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockReturnValue(undefined);
  });

  afterEach(() => {
    runner.queue.close();
    rmSync(runner.dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('Should name an earlier row, not sent, as the cause of each state notification', async () => {
    runner = startRunner();
    await day(runner);

    const rows = allRows(runner.queue);
    const states = rows.filter(isState);
    expect(states.length).toBeGreaterThan(0);
    states.forEach(({ seq, data }) => {
      const cause = rows.find((row) => row.seq === data.cause);
      expect(Object.keys(data)).toEqual(['kind', 'cause']);
      expect(cause?.kind).not.toBe('sent');
      expect(cause?.seq).toBeLessThan(seq);
    });
  });

  it('Should write the exit row before the notification of the end of its script', async () => {
    runner = startRunner();
    await day(runner);

    const rows = allRows(runner.queue);
    const states = rows.filter(isState);
    const sent = documents(runner);
    expect(sent).toHaveLength(states.length);
    // the first document of an entry whose latest command is the
    // finished script of its state
    const seen = new Set<number>();
    const ends = states.filter((_, i) => {
      const { machine, command } = sent[i];
      const entry = machine?.entry ?? 0;
      const end = command?.name === machine?.state && !seen.has(entry);
      if (!end || command?.status === 'running') {
        return false;
      }
      seen.add(entry);
      return true;
    });
    expect(ends.length).toBeGreaterThan(0);
    ends.forEach(({ data }) => {
      expect(rows.find(({ seq }) => seq === data.cause)?.kind).toBe('exit');
    });
  });

  it('Should record the other notifications whole', async () => {
    runner = startRunner();
    runner.connect();
    as('alice', () => runner.fsm.escalate({ reason: 'no beds' }));
    await runner.notifier.beforeApplicationShutdown();

    const sent = allRows(runner.queue)
      .filter(({ kind, data }) => kind === 'sent' && data.kind !== 'state')
      .map(({ by, data }) => [by, data.kind, data.data]);
    const online = expect.objectContaining({ online: true });
    const offline = { online: false };
    // online to the webhook at start and to the broker at its connect;
    // offline to both at shutdown
    expect(sent).toEqual([
      [null, 'presence', online],
      [null, 'presence', online],
      [null, 'escalation', expect.objectContaining({ reason: 'no beds' })],
      [null, 'presence', offline],
      [null, 'presence', offline],
    ]);
  });

  it('Should write no sent row without a transport', async () => {
    runner = startRunner(false);
    await day(runner);
    await runner.notifier.beforeApplicationShutdown();

    expect(allRows(runner.queue).filter(({ kind }) => kind === 'sent')).toEqual(
      [],
    );
  });
});
