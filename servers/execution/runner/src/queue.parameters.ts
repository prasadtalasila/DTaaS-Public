import type { ParameterValue } from './dto/parameters.dto.js';

export const INSERT_PARAMETER =
  'INSERT INTO parameters (name, value, changed_at) VALUES (?, ?, ?)';

// The latest value of each parameter; the highest id is the latest, as
// two changes can share a timestamp
export const PARAMETER_VALUES = `SELECT name, value FROM parameters WHERE id IN
  (SELECT MAX(id) FROM parameters GROUP BY name)`;

export const toParameterValues = (
  rows: Record<string, unknown>[],
): Record<string, ParameterValue> =>
  Object.fromEntries(
    rows.map(({ name, value }) => [String(name), JSON.parse(String(value))]),
  );
