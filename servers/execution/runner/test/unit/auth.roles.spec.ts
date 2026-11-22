import { describe, expect, it } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { Role } from 'src/auth/auth.config';
import { authorize, listedCommand, ROUTE_ROLES } from 'src/auth/roles';
import { MqttRoute, mqttRoutes } from 'src/mqtt/mqtt.config';

// The role table of the spec: open, yes, no, or manager.commands
const TABLE: Record<MqttRoute, [string, string, string, string]> = {
  health: ['open', 'open', 'open', 'open'],
  dt: ['yes', 'yes', 'yes', 'no'],
  state: ['yes', 'yes', 'yes', 'no'],
  status: ['yes', 'yes', 'yes', 'no'],
  history: ['yes', 'yes', 'yes', 'no'],
  metrics: ['yes', 'yes', 'yes', 'no'],
  fsm: ['yes', 'yes', 'yes', 'no'],
  parameters: ['yes', 'yes', 'yes', 'no'],
  execute: ['yes', 'listed', 'no', 'no'],
  stop: ['yes', 'no', 'no', 'no'],
  transition: ['yes', 'no', 'no', 'no'],
  event: ['yes', 'no', 'yes', 'no'],
  escalate: ['yes', 'no', 'yes', 'no'],
  'set-parameters': ['yes', 'yes', 'no', 'no'],
  peers: ['yes', 'yes', 'yes', 'no'],
  'set-peers': ['yes', 'yes', 'no', 'no'],
  properties: ['yes', 'yes', 'yes', 'yes'],
  'set-properties': ['yes', 'no', 'yes', 'yes'],
};

const ROLES: Role[] = ['client', 'manager', 'script', 'sensor'];

const cases = mqttRoutes.flatMap((route) =>
  ROLES.map((role, column) => [route, role, TABLE[route][column]] as const),
);

function allows(role: Role, route: MqttRoute, listed: boolean): boolean {
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
    expect(Object.keys(ROUTE_ROLES).sort()).toEqual([...mqttRoutes].sort());
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
});
