// The keys of runner.yaml that moved under relationships in 0.11, with
// their new paths; the old keys go in 0.12
const MOVED: readonly { old: string; path: readonly string[] }[] = [
  { old: 'notify', path: ['relationships', 'manager', 'notify'] },
  { old: 'peers', path: ['relationships', 'peers'] },
];

type Mapping = Record<string, unknown>;

export type Layout = {
  // the content with every old key at its new path
  content: unknown;
  // one warning for each old key that the file uses
  warnings: string[];
  // one problem for each section that the file sets in both places
  problems: string[];
};

const isMapping = (value: unknown): value is Mapping =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const valueAt = (content: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>(
    (value, key) => (isMapping(value) ? value[key] : undefined),
    content,
  );

// A copy of the mapping with the value at the path; a part of the path
// that is no mapping is left for the schema to refuse
function withValue(
  content: Mapping,
  [key, ...rest]: readonly string[],
  value: unknown,
): Mapping {
  if (rest.length === 0) {
    return { ...content, [key]: value };
  }
  const inner = content[key] ?? {};
  return isMapping(inner)
    ? { ...content, [key]: withValue(inner, rest, value) }
    : content;
}

const without = (content: Mapping, key: string): Mapping =>
  Object.fromEntries(Object.entries(content).filter(([name]) => name !== key));

// Moves the old keys of a parsed runner.yaml to their new paths, so
// that the schema and the rest of the runner know one layout only
export function toLayout(content: unknown): Layout {
  const layout: Layout = { content, warnings: [], problems: [] };
  if (!isMapping(content)) {
    return layout;
  }
  const used = MOVED.filter(({ old }) => Object.hasOwn(content, old));
  used.forEach(({ old, path }) => {
    const target = path.join('.');
    if (valueAt(content, path) !== undefined) {
      layout.problems.push(`${old} and ${target} are both set`);
      return;
    }
    const moved = withValue(layout.content as Mapping, path, content[old]);
    layout.content = without(moved, old);
    layout.warnings.push(`${old} moved to ${target}`);
  });
  return layout;
}
