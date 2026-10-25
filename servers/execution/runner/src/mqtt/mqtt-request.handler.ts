import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { MESSAGES } from '@nestjs/core/constants.js';
import DescriptorService from '../descriptor.service.js';
import ExecaManager from '../execa-manager.service.js';
import {
  executeCommandSchema,
  executeResponse,
  requestKeySchema,
} from '../dto/command.dto.js';
import { eventSchema, fsmReply, transitionSchema } from '../dto/fsm.dto.js';
import FsmService from '../fsm/fsm.service.js';
import { validationFailed } from '../validation.pipe.js';
import { MqttRoute } from './mqtt.config.js';

function parseJson(payload: Buffer): unknown {
  try {
    return JSON.parse(payload.toString());
  } catch {
    return undefined;
  }
}

// Answers an MQTT request with the JSON body that the matching
// HTTP route returns, so that both protocols share one API.
@Injectable()
export default class MqttRequestHandler {
  private readonly logger = new Logger(MqttRequestHandler.name);

  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly manager: ExecaManager,
    private readonly fsm: FsmService,
    private readonly descriptor: DescriptorService,
  ) {} // eslint-disable-line no-empty-function

  private readonly routes: Record<
    MqttRoute,
    (payload: Buffer, requestKey?: string) => unknown
  > = {
    execute: this.whenValid(executeCommandSchema, async ({ name }, key) => {
      const [success] = await this.manager.newCommand(name, key);
      return executeResponse(success);
    }),
    status: () => this.manager.checkStatus(),
    history: () => this.manager.checkHistory(),
    transition: this.whenValid(transitionSchema, ({ state }, key) =>
      this.fsm.transition(state, key),
    ),
    event: this.whenValid(eventSchema, ({ event }, key) =>
      this.fsm.event(event, key),
    ),
    fsm: () => this.fsm.check() ?? fsmReply('no state machine', undefined),
    dt: () => this.descriptor.describe(),
  };

  // An unexpected error gets the same body as an HTTP 500 response
  async handle(
    route: MqttRoute,
    payload: Buffer,
    requestKey?: string,
  ): Promise<unknown> {
    try {
      return await this.routes[route](payload, requestKey);
    } catch (error) {
      this.logger.error(`MQTT ${route} request failed: ${error}`);
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: MESSAGES.UNKNOWN_EXCEPTION_MESSAGE,
      };
    }
  }

  // A route that answers a request whose payload or request key is
  // invalid with the validation error of the HTTP API
  private whenValid<T>(
    schema: z.ZodType<T>,
    handle: (request: T, requestKey?: string) => unknown,
  ): (payload: Buffer, requestKey?: string) => unknown {
    return (payload, requestKey) => {
      const request = schema.safeParse(parseJson(payload));
      if (!request.success || !requestKeySchema.safeParse(requestKey).success) {
        return validationFailed().getResponse();
      }
      return handle(request.data, requestKey);
    };
  }
}
