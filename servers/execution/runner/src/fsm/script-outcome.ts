import { Logger } from '@nestjs/common';
import { STATUS } from '../dto/fsm.dto.js';
import ExecaManager from '../execa-manager.service.js';
import { RunOutcome } from '../interfaces/runner.interface.js';
import type Timeline from '../queue.timeline.js';

// The script of an entry, the environment it runs with, whether it may
// still start, and the timeline that holds its end
export type StateScript = {
  state: string;
  entry: number;
  env: Record<string, string>;
  live: () => boolean;
  timeline: Timeline;
};

// Runs the script of an entry and writes its exit row, as the run ends
// and before it is stored, so that the row comes before the notice of
// that end. A script that may no longer start, after shutdown or a
// later entry, is stopped and has no run, and one that could not start,
// as when the database is closed, failed; neither has an outcome.
export default async function scriptOutcome(
  manager: ExecaManager,
  { state, entry, env, live, timeline }: StateScript,
  logger: Logger,
): Promise<RunOutcome | undefined> {
  if (!live()) {
    timeline.exited({ state, entry, status: 'stopped', run: null });
    return undefined;
  }
  let ran = false;
  const ended = (outcome: RunOutcome, run: number) => {
    ran = true;
    timeline.exited({ state, entry, status: STATUS[outcome], run });
  };
  try {
    const [outcome] = await manager.newCommand(state, undefined, {
      env,
      ended,
    });
    return outcome;
  } catch (error) {
    logger.error(`Script of state ${state} did not run: ${error}`);
    if (!ran) {
      timeline.exited({ state, entry, status: STATUS.failed, run: null });
    }
    return 'failed';
  }
}
