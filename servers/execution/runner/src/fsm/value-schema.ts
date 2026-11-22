import { z } from 'zod';
import { nameSchema } from './name.js';

export const SCALAR_TYPES = ['string', 'number', 'integer', 'boolean'] as const;

export const VALUE_TYPES = [...SCALAR_TYPES, 'object', 'array'] as const;

export type ValueType = (typeof VALUE_TYPES)[number];

// The declaration of a value: the keywords of JSON Schema that the
// runner knows, as a Thing Description of the Web of Things uses them,
// and its unit
export type ValueSchema = {
  type: ValueType;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  unit?: string;
  items?: ValueSchema;
  properties?: Record<string, ValueSchema>;
  required?: string[];
};

type Keyword = Exclude<keyof ValueSchema, 'type'>;

// The keywords of a scalar value, which parameters take too
export const scalarKeywords = {
  enum: z
    .array(z.union([z.string(), z.number()]))
    .min(1)
    .optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
};

export const valueSchema: z.ZodType<ValueSchema> = z.strictObject({
  type: z.enum(VALUE_TYPES),
  ...scalarKeywords,
  unit: z.string().min(1).optional(),
  get items() {
    return valueSchema.optional();
  },
  get properties() {
    return z.record(nameSchema, valueSchema).optional();
  },
  required: z.array(nameSchema).optional(),
});

const NUMERIC: readonly Keyword[] = ['enum', 'minimum', 'maximum', 'unit'];

// The keywords that each type may take
const ALLOWED: Record<ValueType, readonly Keyword[]> = {
  string: ['enum'],
  number: NUMERIC,
  integer: NUMERIC,
  boolean: [],
  object: ['properties', 'required'],
  array: ['items'],
};

// The keywords that each type can not do without
const NEEDED: Record<ValueType, readonly Keyword[]> = {
  string: [],
  number: [],
  integer: [],
  boolean: [],
  object: ['properties'],
  array: ['items'],
};

// Whether every number must name its unit, as the properties ask, or
// none may, as for the parameters
export type Rules = { units: boolean };

const isNumeric = (type: ValueType): boolean =>
  type === 'number' || type === 'integer';

const needed = ({ type }: ValueSchema, { units }: Rules): readonly Keyword[] =>
  units && isNumeric(type) ? ['unit'] : NEEDED[type];

const allowed = ({ type }: ValueSchema, { units }: Rules): readonly Keyword[] =>
  ALLOWED[type].filter((keyword) => units || keyword !== 'unit');

const KEYWORDS: readonly Keyword[] = [
  ...NUMERIC,
  'items',
  'properties',
  'required',
];

// The keywords that the declaration sets, among its other keys
const keywords = (schema: ValueSchema): Keyword[] =>
  KEYWORDS.filter((keyword) => schema[keyword] !== undefined);

function keywordProblems(schema: ValueSchema, rules: Rules): string[] {
  const set = keywords(schema);
  const misplaced = set
    .filter((keyword) => !allowed(schema, rules).includes(keyword))
    .map((keyword) => `${keyword} does not apply to type ${schema.type}`);
  const missing = needed(schema, rules)
    .filter((keyword) => !set.includes(keyword))
    .map((keyword) => `type ${schema.type} needs ${keyword}`);
  return [...misplaced, ...missing];
}

// What an enum value of each type must be
const BASE: Record<ValueType, z.ZodType> = {
  string: z.string(),
  number: z.number(),
  integer: z.int(),
  boolean: z.boolean(),
  object: z.object({}),
  array: z.array(z.unknown()),
};

// The enum values that are not of the type, a minimum above the
// maximum, and the required names that are no properties
function consistencyProblems(schema: ValueSchema): string[] {
  const { type, minimum = -Infinity, maximum = Infinity } = schema;
  const values = (schema.enum ?? [])
    .filter((value) => !BASE[type].safeParse(value).success)
    .map((value) => `enum value ${JSON.stringify(value)} is no ${type}`);
  const bounds = minimum > maximum ? ['minimum is above maximum'] : [];
  const names = (schema.required ?? [])
    .filter((name) => !Object.hasOwn(schema.properties ?? {}, name))
    .map((name) => `required ${name} is not one of the properties`);
  return [...values, ...bounds, ...names];
}

const children = (subject: string, schema: ValueSchema) => [
  ...(schema.items ? [[`${subject} items`, schema.items] as const] : []),
  ...Object.entries(schema.properties ?? {}).map(
    ([name, child]) => [`${subject}.${name}`, child] as const,
  ),
];

// The problems of a declaration that its schema can not see, each after
// its subject, for the declaration and for every value nested in it
export function schemaProblems(
  subject: string,
  schema: ValueSchema,
  rules: Rules,
): string[] {
  // a misplaced keyword is named once, not for what it holds as well
  const misplaced = keywordProblems(schema, rules);
  const own = misplaced.length > 0 ? misplaced : consistencyProblems(schema);
  return [
    ...own.map((problem) => `${subject}: ${problem}`),
    ...children(subject, schema).flatMap(([name, child]) =>
      schemaProblems(name, child, rules),
    ),
  ];
}

function bounded({ type, minimum, maximum }: ValueSchema): z.ZodType {
  const base = type === 'integer' ? z.int() : z.number();
  const lower = minimum === undefined ? base : base.min(minimum);
  return maximum === undefined ? lower : lower.max(maximum);
}

const scalar = (schema: ValueSchema, base: z.ZodType): z.ZodType =>
  schema.enum === undefined ? base : z.literal(schema.enum);

function objectOf({ properties = {}, required = [] }: ValueSchema): z.ZodType {
  const shape = Object.entries(properties).map(([name, child]) => {
    const value = validator(child);
    return [name, required.includes(name) ? value : value.optional()];
  });
  return z.strictObject(Object.fromEntries(shape));
}

const BUILD: Record<ValueType, (schema: ValueSchema) => z.ZodType> = {
  string: (schema) => scalar(schema, z.string()),
  number: (schema) => scalar(schema, bounded(schema)),
  integer: (schema) => scalar(schema, bounded(schema)),
  boolean: () => z.boolean(),
  object: objectOf,
  array: ({ items }) => z.array(items ? validator(items) : z.unknown()),
};

// What checks a value against a declaration without problems
export function validator(schema: ValueSchema): z.ZodType {
  return BUILD[schema.type](schema);
}

const at = (path: PropertyKey[]): string =>
  path
    .map((key) => (typeof key === 'number' ? `[${key}]` : `.${String(key)}`))
    .join('');

// Why the value does not fit the checker of its declaration, each
// problem after the subject and the place in the value
export const valueProblems = (
  subject: string,
  check: z.ZodType,
  value: unknown,
): string[] =>
  (check.safeParse(value).error?.issues ?? []).map(
    ({ path, message }) => `${subject}${at(path)}: ${message}`,
  );
