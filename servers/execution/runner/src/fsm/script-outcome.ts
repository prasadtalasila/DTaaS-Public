import { Logger } from '@nestjs/common';
import ExecaManager from '../execa-manager.service.js';
import { RunOutcome } from '../interfaces/runner.interface.js';

// Runs the script of a state; a script that could not start, as when
// the database is closed, counts as failed
export default async function scriptOutcome(
  manager: ExecaManager,
  state: string,
  logger: Logger,
): Promise<RunOutcome> {
  try {
    const [outcome] = await manager.newCommand(state);
    return outcome;
  } catch (error) {
    logger.error(`Script of state ${state} did not run: ${error}`);
    return 'failed';
  }
}
