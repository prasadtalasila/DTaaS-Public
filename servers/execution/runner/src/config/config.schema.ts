import { z } from 'zod';
import { nameSchema } from '../fsm/definition.js';
import { mqttConfigSchema } from '../mqtt/mqtt.config.js';

// Facts about the digital twin for a Manager; a flat map, so that a
// Manager can filter runners by any of them
const attributesSchema = z.record(
  nameSchema,
  z.union([z.string(), z.number(), z.boolean()]),
);

export type Attributes = z.infer<typeof attributesSchema>;

// The whole of runner.yaml; the paths are relative to that file
export const configSchema = z
  .object({
    id: nameSchema,
    attributes: attributesSchema.default({}),
    stateMachine: z.string().min(1).optional(),
    port: z.int().min(0).max(65535),
    location: z.string(),
    commands: z.array(z.string()),
    // optional SQLite file for the command history and results; the
    // runner keeps them in memory without it
    database: z.string().optional(),
    // optional; the runner serves its API over MQTT as well when it is set
    mqtt: mqttConfigSchema.optional(),
  })
  .strict();
