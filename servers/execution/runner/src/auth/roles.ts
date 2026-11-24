import { ForbiddenException, SetMetadata } from '@nestjs/common';
import { MqttRoute, mqttRoutes } from '../mqtt/mqtt.config.js';
import { Principal, Role } from './auth.config.js';

// The routes of HTTP alone: no MQTT topic deletes a snapshot
const HTTP_ROUTES = ['delete-snapshot'] as const;

export type Route = MqttRoute | (typeof HTTP_ROUTES)[number];

export const routes: readonly Route[] = [...mqttRoutes, ...HTTP_ROUTES];

// The roles that may call a route, or public for a route that needs no
// credential at all
export type RouteRoles = readonly Role[] | 'public';

// Every role but sensor, which may call only the property routes
const EVERY_ROLE: readonly Role[] = ['client', 'operator', 'manager', 'script'];

// Who keeps the twin running and may copy it
const OPERATORS: readonly Role[] = ['client', 'operator'];

// One row for each route, which HTTP and MQTT share; a manager may
// execute only the commands of manager.commands
export const ROUTE_ROLES: Record<Route, RouteRoles> = {
  health: 'public',
  dt: EVERY_ROLE,
  state: EVERY_ROLE,
  status: EVERY_ROLE,
  history: EVERY_ROLE,
  metrics: EVERY_ROLE,
  fsm: EVERY_ROLE,
  parameters: EVERY_ROLE,
  execute: ['client', 'manager'],
  stop: OPERATORS,
  transition: ['client'],
  event: ['client', 'script'],
  escalate: ['client', 'script'],
  'set-parameters': ['client', 'manager'],
  peers: EVERY_ROLE,
  'set-peers': ['client', 'manager'],
  // a manager tunes parameters; it may not write what the DT observes
  properties: [...EVERY_ROLE, 'sensor'],
  'set-properties': ['client', 'script', 'sensor'],
  timeline: EVERY_ROLE,
  snapshots: OPERATORS,
  save: OPERATORS,
  'delete-snapshot': OPERATORS,
};

export const ACCESS_ROUTE = 'accessRoute';

// Names the row of ROUTE_ROLES that guards an HTTP handler
export const AccessRoute = (route: Route) => SetMetadata(ACCESS_ROUTE, route);

const managerExecutes = (role: Role, route: Route): boolean =>
  role === 'manager' && route === 'execute';

// Whether the body asks to execute one of manager.commands
export const listedCommand = (
  commands: readonly string[],
  body: unknown,
): boolean => {
  const name = (body as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && commands.includes(name);
};

// Refuses the principal the route with a 403; listed tells whether the
// command of an execute request is one of manager.commands
export function authorize(
  { role }: Principal,
  route: Route,
  listed: boolean,
): void {
  const roles = ROUTE_ROLES[route];
  const allowed =
    roles === 'public' ||
    (roles.includes(role) && (listed || !managerExecutes(role, route)));
  if (!allowed) {
    throw new ForbiddenException(`${role} may not call ${route}`);
  }
}
