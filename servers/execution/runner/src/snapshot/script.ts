import { currentCaller } from '../auth/caller-context.js';
import type Config from '../config/configuration.service.js';
import { executeReply, ExecuteResponseDto } from '../dto/command.dto.js';
import type FsmService from '../fsm/fsm.service.js';

// What runs a save or a restore script, and the mode of its run in the
// history: what-if for the save that makes the copy of a what-if
export type ScriptHost = {
  config: Config;
  fsm: FsmService;
  mode?: 'what-if';
};

// Runs the save or the restore script as any command, with
// DT_SNAPSHOT_DIR set to files, and stops it once the timeout passes
export async function runSnapshotScript(
  { config, fsm, mode }: ScriptHost,
  name: string,
  files: string,
): Promise<ExecuteResponseDto> {
  const { manager } = fsm;
  const env = { ...fsm.environment(name), DT_SNAPSHOT_DIR: files };
  const options = { env, by: currentCaller().by, mode };
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
