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

// Writes the exit row of an entry once: as its run ends, or else as the
// request settles, for a run that it joined or that could not start
function exitOnce({ state, entry, timeline }: StateScript) {
  let run: number | null = null;
  let written = false;
  const exit = (outcome: RunOutcome) => {
    if (!written) {
      written = true;
      timeline.exited({ state, entry, status: STATUS[outcome], run });
    }
  };
  const onRun = (id: number) => {
    run = id;
  };
  const ended = (outcome: RunOutcome, id: number) => {
    onRun(id);
    exit(outcome);
  };
  return { onRun, ended, exit };
}

// Runs the script of an entry and writes its exit row, as the run ends
// and before it is stored, so that the row comes before the notice of
// that end. A script that may no longer start, after shutdown or a
// later entry, is stopped and has no run or outcome; one that could not
// start, as when the database is closed, is invalid with outcome failed.
export default async function scriptOutcome(
  manager: ExecaManager,
  script: StateScript,
  logger: Logger,
): Promise<RunOutcome | undefined> {
  const { state, entry, env, live, timeline } = script;
  if (!live()) {
    timeline.exited({ state, entry, status: 'stopped', run: null });
    return undefined;
  }
  const { onRun, ended, exit } = exitOnce(script);
  try {
    const options = { env, onRun, ended };
    const [outcome] = await manager.newCommand(state, undefined, options);
    exit(outcome);
    return outcome;
  } catch (error) {
    logger.error(`Script of state ${state} did not run: ${error}`);
    exit('failed');
    return 'failed';
  }
}
