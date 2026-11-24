import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import Config from '../config/configuration.service.js';
import FsmService from '../fsm/fsm.service.js';
import { saving } from '../snapshot/pause.js';
import Access from './access.js';
import { callerContext } from './caller-context.js';
import { Principal } from './auth.config.js';
import {
  ACCESS_ROUTE,
  authorize,
  listedCommand,
  Route,
  ROUTE_ROLES,
} from './roles.js';

// The request as the guard leaves it: rawBody is Nest's with rawBody on
export type CallerRequest = Request & {
  rawBody?: Buffer;
  principal?: Principal;
};

// Checks the credential and the role of every HTTP request, as an
// APP_GUARD, so that no new controller is missed, and refuses a change
// while a save runs; Nest runs it after the body parser (413) and
// before the pipes (400)
@Injectable()
export default class AccessGuard implements CanActivate {
  private readonly logger = new Logger(AccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly config: Config,
    private readonly fsm: FsmService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const route = this.reflector.get<Route | undefined>(
      ACCESS_ROUTE,
      context.getHandler(),
    );
    const access = this.config.access();
    if (access !== undefined) {
      this.authorize(access, route, context.switchToHttp().getRequest());
    }
    if (route !== undefined && this.fsm.pause.refuses(route)) {
      throw saving();
    }
    return true;
  }

  private authorize(
    access: Access,
    route: Route | undefined,
    request: CallerRequest,
  ) {
    if (route === undefined) {
      throw new ForbiddenException();
    }
    if (ROUTE_ROLES[route] !== 'public') {
      this.check(access, route, request);
    }
  }

  // Leaves the principal on the request for the handler
  private check(access: Access, route: Route, request: CallerRequest) {
    const { method, path, rawBody, headers } = request;
    const call = { method, path, body: rawBody };
    const principal = access.http(headers.authorization, call);
    const commands = this.fsm.declared()?.managerCommands ?? [];
    const listed = listedCommand(commands, request.body);
    authorize(principal, route, listed);
    request.principal = principal;
    // for the rows of the timeline that this request leads to
    callerContext.enterWith({ by: principal.name });
    this.logger.debug(`${principal.name} calls ${route}`);
  }
}
