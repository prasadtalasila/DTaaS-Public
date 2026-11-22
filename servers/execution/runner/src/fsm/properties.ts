import { z } from 'zod';
import {
  PropertiesBody,
  PropertiesDto,
  PropertyState,
  PropertyValue,
} from '../dto/properties.dto.js';
import Changes, { ChangeListener } from '../notify/changes.js';
import { nameSchema, reservedProblems } from './name.js';
import {
  schemaProblems,
  validator,
  valueProblems,
  valueSchema,
  ValueSchema,
} from './value-schema.js';

export const propertiesSchema = z.record(nameSchema, valueSchema).default({});

export type PropertyDeclarations = ReadonlyMap<string, ValueSchema>;

type Section = {
  parameters: ReadonlyMap<string, unknown>;
  properties: PropertyDeclarations;
};

// The problems of the properties of a definition that their schema can
// not see; every number names its unit
export function propertyProblems({
  parameters,
  properties,
}: Section): string[] {
  const entries = [...properties];
  const declared = entries.flatMap(([name, declaration]) =>
    schemaProblems(`property ${name}`, declaration, { units: true }),
  );
  const shared = entries
    .filter(([name]) => parameters.has(name))
    .map(([name]) => `${name} is both a parameter and a property`);
  const names = [...properties.keys()];
  return [...declared, ...shared, ...reservedProblems('property', names)];
}

// A stored property: its name with its latest value
export type PropertyRow = PropertyValue & { name: string; time: string };

// Where the latest values are kept, as Queue keeps them
export type PropertyStore = {
  saveProperties(rows: PropertyRow[]): void;
  storedProperties(): PropertyRow[];
};

const UNKNOWN: PropertyValue = { value: null, time: null, by: null };

// The declared properties of a digital twin and the latest value of
// each, which scripts and sensors write. The runner checks, keeps and
// shows the values; it never reads them.
export default class Properties {
  private declarations: PropertyDeclarations | undefined;

  private checks = new Map<string, z.ZodType>();

  private store: PropertyStore | undefined;

  private readonly latest = new Map<string, PropertyValue>();

  // Signals a write, which may change the state document
  private readonly changes = new Changes();

  // Takes the stored values that still fit their declarations, with
  // their times, and returns the names of the others, which are unknown
  // again. Without declarations, the DT has no state machine file.
  load(
    declarations: PropertyDeclarations | undefined,
    store: PropertyStore,
  ): string[] {
    this.declarations = declarations;
    this.store = store;
    this.checks = new Map(
      [...(declarations ?? [])].map(([name, schema]) => [
        name,
        validator(schema),
      ]),
    );
    this.latest.clear();
    const rows = declarations === undefined ? [] : store.storedProperties();
    const fits = rows.filter(
      ({ name, value }) => this.problems(name, value).length === 0,
    );
    fits.forEach(({ name, ...written }) => this.latest.set(name, written));
    return rows.filter((row) => !fits.includes(row)).map(({ name }) => name);
  }

  onChange(listener: ChangeListener): void {
    this.changes.on(listener);
  }

  // The latest value and the declaration of each property; undefined
  // without a state machine file
  document(): PropertiesDto | undefined {
    const entries = [...(this.declarations ?? [])].map(
      ([name, declaration]) => [
        name,
        { ...this.written(name), ...declaration },
      ],
    );
    return this.declarations && Object.fromEntries(entries);
  }

  // The properties as the state document shows them
  values(): Record<string, PropertyState> {
    const names = [...(this.declarations?.keys() ?? [])];
    return Object.fromEntries(
      names.map((name) => {
        const { value, time } = this.written(name);
        return [name, { value, time }];
      }),
    );
  }

  // Checks the whole body before it stores and applies the values, and
  // returns every problem found instead. A value written again gets a
  // new time, which shows that its feed is alive.
  set(body: PropertiesBody, by?: string): string[] {
    // without a state machine file the caller gets the 404 of the read
    const entries = this.declarations ? Object.entries(body) : [];
    const problems = entries.flatMap(([name, value]) =>
      this.problems(name, value),
    );
    if (problems.length > 0 || entries.length === 0) {
      return problems;
    }
    const time = new Date().toISOString();
    const rows = entries.map(([name, value]) => ({
      name,
      value,
      time,
      by: by ?? null,
    }));
    this.store?.saveProperties(rows);
    rows.forEach(({ name, ...written }) => this.latest.set(name, written));
    this.changes.emit();
    return [];
  }

  private written(name: string): PropertyValue {
    return this.latest.get(name) ?? UNKNOWN;
  }

  // null fits every declaration: the value is not known
  private problems(name: string, value: unknown): string[] {
    const check = this.checks.get(name);
    if (check === undefined) {
      return [`property ${name} is not declared`];
    }
    return valueProblems(`property ${name}`, check.nullable(), value);
  }
}
