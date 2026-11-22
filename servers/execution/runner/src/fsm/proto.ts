export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// The value of a key of a parsed YAML mapping
export const field = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

export const hasOwnProto = (value: unknown): boolean =>
  isRecord(value) && Object.hasOwn(value, '__proto__');

// zod skips a __proto__ key of a record without an error, so look for
// one among the states, the events of their transitions, the env of
// the file and of each state, the parameters and, at any depth, the
// properties
export function hasProtoKey(content: unknown): boolean {
  const states = field(content, 'states');
  const values = isRecord(states) ? Object.values(states) : [];
  const nested = ['transitions', 'env'].flatMap((key) =>
    values.map((state) => field(state, key)),
  );
  const top = ['parameters', 'env'].map((key) => field(content, key));
  return (
    [states, ...nested, ...top].some(hasOwnProto) ||
    hasDeepProto(field(content, 'properties'))
  );
}

function hasDeepProto(value: unknown): boolean {
  return (
    isRecord(value) &&
    (hasOwnProto(value) || Object.values(value).some(hasDeepProto))
  );
}
