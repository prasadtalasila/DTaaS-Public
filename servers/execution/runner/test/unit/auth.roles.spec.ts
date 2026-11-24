import { describe, expect, it } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { Role } from 'src/auth/auth.config';
import {
  authorize,
  listedCommand,
  managerListed,
  Route,
  ROUTE_ROLES,
  routes,
} from 'src/auth/roles';

type Row = [string, string, string, string, string];

// The role table of the spec: open, yes, no, or manager.commands
const TABLE: Record<Route, Row> = {
  health: ['open', 'open', 'open', 'open', 'open'],
  dt: ['yes', 'yes', 'yes', 'yes', 'no'],
  state: ['yes', 'yes', 'yes', 'yes', 'no'],
  status: ['yes', 'yes', 'yes', 'yes', 'no'],
  history: ['yes', 'yes', 'yes', 'yes', 'no'],
  metrics: ['yes', 'yes', 'yes', 'yes', 'no'],
  fsm: ['yes', 'yes', 'yes', 'yes', 'no'],
  parameters: ['yes', 'yes', 'yes', 'yes', 'no'],
  execute: ['yes', 'no', 'listed', 'no', 'no'],
  stop: ['yes', 'yes', 'no', 'no', 'no'],
  transition: ['yes', 'no', 'no', 'no', 'no'],
  event: ['yes', 'no', 'no', 'yes', 'no'],
  escalate: ['yes', 'no', 'no', 'yes', 'no'],
  'set-parameters': ['yes', 'no', 'yes', 'no', 'no'],
  peers: ['yes', 'yes', 'yes', 'yes', 'no'],
  'set-peers': ['yes', 'no', 'yes', 'no', 'no'],
  properties: ['yes', 'yes', 'yes', 'yes', 'yes'],
  'set-properties': ['yes', 'no', 'no', 'yes', 'yes'],
  timeline: ['yes', 'yes', 'yes', 'yes', 'no'],
  snapshots: ['yes', 'yes', 'no', 'no', 'no'],
  save: ['yes', 'yes', 'no', 'no', 'no'],
  'delete-snapshot': ['yes', 'yes', 'no', 'no', 'no'],
  whatif: ['yes', 'no', 'listed', 'no', 'no'],
  'whatif-result': ['yes', 'yes', 'yes', 'no', 'no'],
  notice: ['no', 'yes', 'no', 'no', 'no'],
};

const ROLES: Role[] = ['client', 'operator', 'manager', 'script', 'sensor'];

const cases = routes.flatMap((route) =>
  ROLES.map((role, column) => [route, role, TABLE[route][column]] as const),
);

function allows(role: Role, route: Route, listed: boolean): boolean {
  try {
    authorize({ name: 'someone', role }, route, listed);
    return true;
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).message).toBe(
      `${role} may not call ${route}`,
    );
    return false;
  }
}

describe('Roles', () => {
  it('Should have a row for every route, health open', () => {
    expect(Object.keys(ROUTE_ROLES).sort()).toEqual([...routes].sort());
    expect(ROUTE_ROLES.health).toBe('public');
  });

  it.each([
    [{ name: 'admit' }, true],
    [{ name: 'open' }, false],
    [{ name: ['admit'] }, false],
    [{}, false],
    [null, false],
    [undefined, false],
  ])('Should tell whether %j executes a listed command', (body, listed) => {
    expect(listedCommand(['admit', 'discharge'], body)).toBe(listed);
  });

  it.each(cases)('Should answer %s for %s as %s', (route, role, answer) => {
    const listed = allows(role, route, true);
    const unlisted = allows(role, route, false);

    expect([listed, unlisted]).toEqual(
      {
        open: [true, true],
        yes: [true, true],
        no: [false, false],
        listed: [true, false],
      }[answer],
    );
  });

  const lists = {
    managerCommands: ['admit', 'forecast-beds'],
    whatIf: { commands: ['forecast-beds', 'forecast-staff'] },
  };

  it.each([
    ['whatif', 'forecast-beds', true],
    ['whatif', 'forecast-staff', false],
    ['whatif', 'admit', false],
    ['execute', 'admit', true],
    ['execute', 'forecast-staff', false],
  ] as const)(
    'Should tell whether a manager may ask %s for %s',
    (route, name, listed) => {
      expect(managerListed(route, lists, { name })).toBe(listed);
    },
  );

  it('Should list nothing for a manager without a class', () => {
    expect(managerListed('whatif', undefined, { name: 'admit' })).toBe(false);
  });
});
