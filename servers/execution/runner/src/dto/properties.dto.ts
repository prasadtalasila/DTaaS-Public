import { z } from 'zod';
import type { ValueSchema } from '../fsm/value-schema.js';

// The body of PUT /properties: the names of properties and their new
// values, null for a value that is not known. Properties checks the
// values, so that every problem can be named.
export const propertiesBodySchema = z.record(z.string(), z.unknown());

export type PropertiesBody = z.infer<typeof propertiesBodySchema>;

// The latest value of a property, when it was written and by whom; all
// null until the first write, and by null without access control
export type PropertyValue = {
  value: unknown;
  time: string | null;
  by: string | null;
};

// A property in GET /properties: its latest value and its declaration
export type PropertyDto = PropertyValue & ValueSchema;

export type PropertiesDto = Record<string, PropertyDto>;

// A property in the state document
export type PropertyState = Pick<PropertyValue, 'value' | 'time'>;
