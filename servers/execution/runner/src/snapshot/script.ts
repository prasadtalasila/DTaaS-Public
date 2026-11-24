import { currentCaller } from '../auth/caller-context.js';
import type Config from '../config/configuration.service.js';
import { executeReply, ExecuteResponseDto } from '../dto/command.dto.js';
import type FsmService from '../fsm/fsm.service.js';

// What runs a save or a restore script
export type ScriptHost = { config: Config; fsm: FsmService };

// Runs the save or the restore script as any command, with
// DT_SNAPSHOT_DIR set to files, and stops it once the timeout passes
export async function runSnapshotScript(
  { config, fsm }: ScriptHost,
  name: string,
  files: string,
): Promise<ExecuteResponseDto> {
  const { manager } = fsm;
  const env = { ...fsm.environment(name), DT_SNAPSHOT_DIR: files };
  const options = { env, by: currentCaller().by };
  const timer = setTimeout(
    () => void manager.stop(name),
    config.getSnapshotTimeout(),
  );
  try {
    return await executeReply(manager.newCommand(name, undefined, options));
  } finally {
    clearTimeout(timer);
  }
}
