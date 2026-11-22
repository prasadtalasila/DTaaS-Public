import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { parseDefinition } from 'src/fsm/definition';
import Properties, { PropertyRow, PropertyStore } from 'src/fsm/properties';

const NOW = new Date('2026-11-22T10:00:00.000Z');

const EARLIER = '2026-11-22T09:00:00.000Z';

const EXAMPLE = `
properties:
  free-beds: {type: integer, minimum: 0, unit: beds}
  ward-status: {type: string, enum: [open, full, closed]}
  forecast:
    type: array
    items: {type: number, unit: beds}
`;

const parse = (text: string) =>
  parseDefinition(text, 'dt.yaml', { commands: ['create'], peers: [] });

// A store that keeps the rows it is given, as Queue does
function memory(
  rows: PropertyRow[] = [],
): PropertyStore & { rows: PropertyRow[] } {
  const store = {
    rows,
    saveProperties: jest.fn((saved: PropertyRow[]) => {
      store.rows.push(...saved);
    }),
    storedProperties: () => store.rows,
  };
  return store;
}

function setup(rows: PropertyRow[] = []) {
  const store = memory(rows);
  const properties = new Properties();
  const dropped = properties.load(parse(EXAMPLE).properties, store);
  const changed = jest.fn();
  properties.onChange(changed);
  return { properties, store, dropped, changed };
}

describe('Properties', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('Should be unknown until the first write', () => {
    const { properties } = setup();

    expect(properties.values()).toEqual({
      'free-beds': { value: null, time: null },
      'ward-status': { value: null, time: null },
      forecast: { value: null, time: null },
    });
    expect(properties.document()?.['ward-status']).toEqual({
      value: null,
      time: null,
      by: null,
      type: 'string',
      enum: ['open', 'full', 'closed'],
    });
  });

  it('Should store and show a written value with its time and writer', () => {
    jest.useFakeTimers({ now: NOW });
    const { properties, store, changed } = setup();

    expect(
      properties.set({ 'free-beds': 1, forecast: [1, 0.5] }, 'ward-gateway'),
    ).toEqual([]);

    const written = { time: NOW.toISOString(), by: 'ward-gateway' };
    expect(store.rows).toEqual([
      { name: 'free-beds', value: 1, ...written },
      { name: 'forecast', value: [1, 0.5], ...written },
    ]);
    expect(properties.values()['free-beds']).toEqual({
      value: 1,
      time: NOW.toISOString(),
    });
    expect(properties.document()?.['free-beds']).toEqual({
      value: 1,
      ...written,
      type: 'integer',
      minimum: 0,
      unit: 'beds',
    });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('Should write without a principal when there is no access control', () => {
    const { properties } = setup();
    properties.set({ 'free-beds': 1 });

    expect(properties.document()?.['free-beds'].by).toBeNull();
  });

  it('Should take null for a value that is not known', () => {
    const { properties } = setup();
    properties.set({ 'free-beds': 1 });

    expect(properties.set({ 'free-beds': null })).toEqual([]);
    expect(properties.values()['free-beds'].value).toBeNull();
  });

  it('Should give a value written again a new time', () => {
    jest.useFakeTimers({ now: NOW });
    const { properties, changed } = setup();
    properties.set({ 'free-beds': 1 });
    jest.setSystemTime(NOW.getTime() + 5000);
    properties.set({ 'free-beds': 1 });

    expect(properties.values()['free-beds'].time).toBe(
      '2026-11-22T10:00:05.000Z',
    );
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('Should list every problem of a body and apply none of it', () => {
    const { properties, store, changed } = setup();
    const body = {
      'free-beds': -1,
      'ward-status': 'shut',
      colour: 'red',
      forecast: [1],
    };

    expect(properties.set(body)).toEqual([
      expect.stringMatching(/^property free-beds: Too small/),
      expect.stringMatching(/^property ward-status: /),
      'property colour is not declared',
    ]);
    expect(store.saveProperties).not.toHaveBeenCalled();
    expect(properties.values().forecast.value).toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });

  it('Should change nothing for an empty body', () => {
    const { properties, store, changed } = setup();

    expect(properties.set({})).toEqual([]);
    expect(store.saveProperties).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it('Should keep the values when the store fails', () => {
    const { properties, store } = setup();
    store.saveProperties = () => {
      throw new Error('disk full');
    };

    expect(() => properties.set({ 'free-beds': 1 })).toThrow('disk full');
    expect(properties.values()['free-beds'].value).toBeNull();
  });

  it('Should restore the stored values with their times', () => {
    const { properties, dropped } = setup([
      { name: 'free-beds', value: 2, time: EARLIER, by: 'script' },
      { name: 'ward-status', value: null, time: EARLIER, by: null },
    ]);

    expect(dropped).toEqual([]);
    expect(properties.document()?.['free-beds']).toMatchObject({
      value: 2,
      time: EARLIER,
      by: 'script',
    });
    expect(properties.values()['ward-status']).toEqual({
      value: null,
      time: EARLIER,
    });
  });

  it('Should drop the stored values that no longer fit', () => {
    const { properties, dropped } = setup([
      { name: 'free-beds', value: 'two', time: EARLIER, by: 'script' },
      { name: 'colour', value: 'red', time: EARLIER, by: 'script' },
      { name: 'ward-status', value: 'open', time: EARLIER, by: 'script' },
    ]);

    expect(dropped).toEqual(['free-beds', 'colour']);
    expect(properties.values()['free-beds']).toEqual({
      value: null,
      time: null,
    });
    expect(properties.values()['ward-status'].value).toBe('open');
  });

  it('Should have no document without a state machine file', () => {
    const properties = new Properties();

    expect(properties.document()).toBeUndefined();
    expect(properties.load(undefined, memory())).toEqual([]);
    expect(properties.document()).toBeUndefined();
    expect(properties.values()).toEqual({});
    expect(properties.set({ a: 1 })).toEqual([]);
  });

  it('Should have an empty document for a file without properties', () => {
    const properties = new Properties();
    properties.load(new Map(), memory());

    expect(properties.document()).toEqual({});
  });
});
