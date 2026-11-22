import { z } from 'zod';

// A state names a script, so a name can not be a path, a flag or an
// object property such as __proto__
const NAME = /^[A-Za-z0-9][\w.-]{0,63}$/;

export const nameSchema = z
  .string()
  .regex(NAME, 'must be up to 64 letters, digits, _, . or -, from a letter');

// The topic levels under the MQTT topic of a resource: its write topic
// and its default response topic
const RESERVED: readonly string[] = ['set', 'response'];

const RESERVED_MESSAGE = 'set and response are reserved';

// The id of a peer, which may become a topic level under the topic of
// the peers
export const resourceNameSchema = nameSchema.refine(
  (name) => !RESERVED.includes(name),
  RESERVED_MESSAGE,
);

// The problems of the names of parameters or properties, which are the
// keys of a record, where zod would not say why it refuses one
export const reservedProblems = (kind: string, names: string[]): string[] =>
  names
    .filter((name) => RESERVED.includes(name))
    .map((name) => `${kind} ${name}: ${RESERVED_MESSAGE}`);
