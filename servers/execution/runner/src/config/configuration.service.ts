import { readFileSync } from 'fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { Injectable } from '@nestjs/common';
import Keyv from 'keyv';
import { z } from 'zod';
import {
  configDefault,
  ConfigValues,
  DEFAULT_STOP_GRACE,
} from './config.interface.js';
import { Attributes, configSchema } from './config.schema.js';
import resolveFile from './util.js';
import Access from '../auth/access.js';
import Signer from '../auth/signer.js';
import { hasOwnProto } from '../fsm/definition.js';
import { MqttConfig } from '../mqtt/mqtt.config.js';
import { NotifyConfig } from '../notify/notify.config.js';

const invalid = (file: string, problems: string): Error =>
  new Error(`Invalid configuration in ${file}:\n${problems}`);

// js-yaml throws on an empty file and on a syntax error, neither of
// which names the file
function readConfig(file: string): unknown {
  try {
    return yaml.load(readFileSync(file, 'utf8'));
  } catch (error) {
    throw invalid(file, String(error));
  }
}

// zod skips a __proto__ key of a record without an error, so look for
// one among the attributes first
function parseConfig(content: unknown, file: string): ConfigValues {
  const attributes = (content as { attributes?: unknown } | null)?.attributes;
  if (hasOwnProto(attributes)) {
    throw invalid(file, '✖ __proto__ is not a valid name\n  → at attributes');
  }
  const result = configSchema.safeParse(content);
  if (!result.success) {
    throw invalid(file, z.prettifyError(result.error));
  }
  return result.data;
}

// location and database keep path.join, so an absolute path is still
// taken as relative to dir; stateMachine may be absolute
const resolvePaths = (dir: string, values: ConfigValues): ConfigValues => ({
  ...values,
  location: path.join(dir, values.location),
  database:
    values.database === undefined ? undefined : path.join(dir, values.database),
  stateMachine:
    values.stateMachine === undefined
      ? undefined
      : path.resolve(dir, values.stateMachine),
});

@Injectable()
export default class Config {
  private configValues: ConfigValues = configDefault;

  private accessControl: Access | undefined;

  private signer = new Signer(undefined, configDefault.id);

  async loadConfig(CLIOptions: Keyv): Promise<void> {
    const configFile = await CLIOptions.get('configFile');
    const file = resolveFile(configFile.toString());
    const values = parseConfig(readConfig(file), file);
    const dir = path.dirname(file);
    this.configValues = resolvePaths(dir, values);
    const { principals, key } = values.auth ?? {};
    this.accessControl = principals && new Access(principals, values.id);
    this.signer = Signer.load(key, dir, values.id);
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

  getDatabase(): string | undefined {
    return this.configValues.database;
  }

  getMqtt(): MqttConfig | undefined {
    return this.configValues.mqtt;
  }

  getStopGrace(): number {
    return this.configValues.stopGrace ?? DEFAULT_STOP_GRACE;
  }

  getNotify(): NotifyConfig | undefined {
    return this.configValues.notify;
  }
}
