import path from 'node:path';
import { Injectable } from '@nestjs/common';
import Keyv from 'keyv';
import {
  configDefault,
  ConfigValues,
  DEFAULT_SNAPSHOT_TIMEOUT,
  DEFAULT_STATE_INTERVAL,
  DEFAULT_STOP_GRACE,
} from './config.interface.js';
import { Attributes } from './attributes.js';
import { invalid, parseConfig, readConfig } from './parse.js';
import resolveFile from './util.js';
import Access from '../auth/access.js';
import { AuthConfig } from '../auth/auth.config.js';
import Signer from '../auth/signer.js';
import { MqttConfig } from '../mqtt/mqtt.config.js';
import { NotifyConfig } from '../notify/notify.config.js';
import { PeerConfig } from '../peers/peers.config.js';
import { ScriptsConfig } from '../scripts/scripts.config.js';
import { checkSeparation, ScriptUser } from '../scripts/separation.js';
import { placementProblems } from '../snapshot/placement.js';
import ReplayMode from '../replay/replay-mode.js';

// The signing key, like stateMachine, may be absolute, as it often
// lives in a mounted secret directory
const resolveAuth = (dir: string, auth: AuthConfig | undefined) =>
  auth?.key === undefined
    ? auth
    : { ...auth, key: path.resolve(dir, auth.key) };

// The run directory often lives under /var/lib, so it may be absolute
const resolveScripts = (dir: string, scripts: ScriptsConfig | undefined) =>
  scripts && {
    ...scripts,
    runDirectory: path.resolve(dir, scripts.runDirectory),
  };

// location and database keep path.join, so an absolute path is still
// taken as relative to dir; stateMachine, auth.key and
// scripts.runDirectory may be absolute
const resolvePaths = (dir: string, values: ConfigValues): ConfigValues => ({
  ...values,
  location: path.join(dir, values.location),
  database:
    values.database === undefined ? undefined : path.join(dir, values.database),
  stateMachine:
    values.stateMachine === undefined
      ? undefined
      : path.resolve(dir, values.stateMachine),
  auth: resolveAuth(dir, values.auth),
  scripts: resolveScripts(dir, values.scripts),
});

// Where snapshots go: the directory resolved, and as runner.yaml gives
// it, for the replies
export type SnapshotsConfig = { directory: string; given: string };

@Injectable()
export default class Config {
  private configValues: ConfigValues = configDefault;

  private file = '';

  private accessControl: Access | undefined;

  private signer = new Signer(undefined, configDefault.id);

  private scriptUser: ScriptUser | undefined;

  private replayMode: ReplayMode | undefined;

  async loadConfig(CLIOptions: Keyv): Promise<void> {
    const configFile = await CLIOptions.get('configFile');
    const file = resolveFile(configFile.toString());
    const values = parseConfig(readConfig(file), file);
    this.file = file;
    this.configValues = resolvePaths(path.dirname(file), values);
    const placement = placementProblems({
      ...this.configValues,
      snapshots: this.getSnapshots()?.directory,
    });
    if (placement.length > 0) {
      throw invalid(file, placement.join('\n'));
    }
    const { principals, key } = this.configValues.auth ?? {};
    this.accessControl = principals && new Access(principals, values.id);
    this.signer = Signer.load(key, values.id);
    this.scriptUser = checkSeparation(file, this.configValues);
    const scale: number | undefined = await CLIOptions.get('replay');
    this.replayMode = scale === undefined ? undefined : new ReplayMode(scale);
  }

  // The mode of a replay twin, which main.ts starts with --what-if;
  // undefined for any other runner
  replay(): ReplayMode | undefined {
    return this.replayMode;
  }

  // Verifies the callers; without principals every route is open
  access(): Access | undefined {
    return this.accessControl;
  }

  // Encodes the notifications and MQTT responses; without a key they
  // are plain JSON
  getSigner(): Signer {
    return this.signer;
  }

  // runner.yaml itself, resolved
  getFile(): string {
    return this.file;
  }

  // Relative to runner.yaml, or absolute; undefined without the section,
  // and in a replay twin, which saves nothing
  getSnapshots(): SnapshotsConfig | undefined {
    const given = this.configValues.snapshots?.directory;
    if (given === undefined || this.replayMode) {
      return undefined;
    }
    return { directory: path.resolve(path.dirname(this.file), given), given };
  }

  getSnapshotTimeout(): number {
    return this.configValues.snapshots?.timeout ?? DEFAULT_SNAPSHOT_TIMEOUT;
  }

  getId(): string {
    return this.configValues.id;
  }

  getAttributes(): Attributes {
    return this.configValues.attributes;
  }

  permitCommands(): Array<string> {
    return this.configValues.commands;
  }

  getPort(): number {
    return this.configValues.port;
  }

  getLocation(): string {
    return this.configValues.location;
  }

  getStateMachine(): string | undefined {
    return this.configValues.stateMachine;
  }

  // The parameter values of this instance, which replace the defaults
  // of the state machine file
  getParameters(): Record<string, string | number | boolean> {
    return this.configValues.parameters ?? {};
  }

  getDatabase(): string | undefined {
    return this.configValues.database;
  }

  // A replay twin connects to no broker, whatever runner.yaml lists
  getMqtt(): MqttConfig | undefined {
    return this.replayMode ? undefined : this.configValues.mqtt;
  }

  getStopGrace(): number {
    return this.configValues.stopGrace ?? DEFAULT_STOP_GRACE;
  }

  getStateInterval(): number {
    return this.configValues.stateInterval ?? DEFAULT_STATE_INTERVAL;
  }

  // A replay twin sends no webhook
  getNotify(): NotifyConfig | undefined {
    return this.replayMode
      ? undefined
      : this.configValues.relationships.manager?.notify;
  }

  // The peers in the order of runner.yaml, with the enabled of the file
  getPeers(): PeerConfig[] {
    return this.configValues.relationships.peers;
  }

  // The account and the directory of the scripts; undefined without
  // scripts.user, when the scripts run as the runner's account
  getScriptUser(): ScriptUser | undefined {
    return this.scriptUser;
  }
}
