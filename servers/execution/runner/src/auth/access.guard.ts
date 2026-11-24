import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import Config from '../config/configuration.service.js';
import FsmService from '../fsm/fsm.service.js';
import { saving } from '../snapshot/pause.js';
import Access from './access.js';
import { replayOrigin } from '../replay/origin.js';
import { callerContext, currentCaller } from './caller-context.js';
import { Principal } from './auth.config.js';
import {
  ACCESS_ROUTE,
  authorize,
  managerListed,
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
    const request: CallerRequest = context.switchToHttp().getRequest();
    this.replayOnly(route);
    const access = this.config.access();
    if (access !== undefined) {
      this.authorize(access, route, request);
    }
    this.replayOrigin(request);
    if (route !== undefined && this.fsm.pause.refuses(route)) {
      throw saving();
    }
    return true;
  }

  // The notice route is there in a replay twin alone
  private replayOnly(route: Route | undefined): void {
    if (route === 'notice' && this.config.replay() === undefined) {
      throw new NotFoundException();
    }
  }

  // A replay twin records the origin that the headers give; any other
  // runner ignores them
  private replayOrigin(request: CallerRequest): void {
    if (this.config.replay() === undefined) {
      return;
    }
    const origin = replayOrigin(request.headers);
    if (origin !== undefined) {
      callerContext.enterWith({ ...currentCaller(), origin });
    }
  }

  // In a replay twin an operator, the tool that drives it, may call
  // every route
  private permit(principal: Principal, route: Route, listed: boolean): void {
    const replay = this.config.replay() !== undefined;
    if (!replay || principal.role !== 'operator') {
      authorize(principal, route, listed);
    }
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
    const listed = managerListed(route, this.fsm.declared(), request.body);
    this.permit(principal, route, listed);
    request.principal = principal;
    // for the rows of the timeline that this request leads to
    callerContext.enterWith({ by: principal.name });
    this.logger.debug(`${principal.name} calls ${route}`);
  }
}
