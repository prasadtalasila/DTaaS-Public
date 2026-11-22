import { z } from 'zod';
import { authSchema } from '../auth/auth.config.js';
import { nameSchema } from '../fsm/definition.js';
import { mqttConfigSchema } from '../mqtt/mqtt.config.js';
import { notifyConfigSchema } from '../notify/notify.config.js';
import { peersSchema, refuseSelf } from '../peers/peers.config.js';
import { scriptsSchema } from '../scripts/scripts.config.js';
import { attributesSchema } from './attributes.js';

// The Manager that the DT notifies, and the peers that it follows
const relationshipsSchema = z
  .object({
    // optional; the webhook that receives the notifications
    manager: z.object({ notify: notifyConfigSchema.optional() }).strict(),
    // optional; the peers that the DT is willing to interact with
    peers: peersSchema.default([]),
  })
  .partial({ manager: true })
  .strict()
  .prefault({});

// The whole of runner.yaml; the paths are relative to that file
export const configSchema = z
  .object({
    id: nameSchema,
    attributes: attributesSchema.default({}),
    stateMachine: z.string().min(1).optional(),
    // optional; the values of parameters of the state machine file for
    // this instance, in place of its defaults
    parameters: z
      .record(nameSchema, z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
    port: z.int().min(0).max(65535),
    location: z.string(),
    commands: z.array(z.string()),
    // optional SQLite file for the command history and results; the
    // runner keeps them in memory without it
    database: z.string().optional(),
    // optional; the runner serves its API over MQTT as well when it is set
    mqtt: mqttConfigSchema.optional(),
    // optional; milliseconds from SIGTERM to SIGKILL when a script is
    // stopped
    stopGrace: z.int().positive().optional(),
    // optional; the principals that may call the runner, and their roles
    auth: authSchema.optional(),
    // optional; milliseconds between state notifications that differ
    // in property values only
    stateInterval: z.int().min(0).optional(),
    // optional; the other parties of the DT in its network
    relationships: relationshipsSchema,
    // optional; the account, on Linux, and the directory the scripts run in
    scripts: scriptsSchema.optional(),
  })
  .strict()
  .superRefine(({ id, mqtt, relationships }, context) =>
    refuseSelf(relationships.peers, { id, topic: mqtt?.topic }, context),
  );
