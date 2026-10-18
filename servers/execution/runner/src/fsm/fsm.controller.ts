import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { REQUEST_KEY, requestKeySchema } from '../dto/command.dto.js';
import {
  EventDto,
  eventSchema,
  fsmReply,
  FsmReplyDto,
  FsmStateDto,
  FSM_STATUS_CODES,
  TransitionDto,
  transitionSchema,
} from '../dto/fsm.dto.js';
import ZodValidationPipe, { validationFailed } from '../validation.pipe.js';
import FsmService from './fsm.service.js';

function validKey(requestKey?: string): string | undefined {
  if (!requestKeySchema.safeParse(requestKey).success) {
    throw validationFailed();
  }
  return requestKey;
}

@Controller('fsm')
export default class FsmController {
  // eslint-disable-next-line no-useless-constructor
  constructor(private readonly fsm: FsmService) {} // eslint-disable-line no-empty-function

  @Get()
  check(@Res({ passthrough: true }) res: Response): FsmStateDto | FsmReplyDto {
    const state = this.fsm.check();
    if (state === undefined) {
      res.status(HttpStatus.NOT_FOUND);
      return fsmReply('no state machine', undefined);
    }
    return state;
  }

  @Post('transition')
  transition(
    @Body(new ZodValidationPipe(transitionSchema)) { state }: TransitionDto,
    @Res({ passthrough: true }) res: Response,
    @Headers(REQUEST_KEY) requestKey?: string,
  ): FsmReplyDto {
    return FsmController.send(
      res,
      this.fsm.transition(state, validKey(requestKey)),
    );
  }

  @Post('event')
  event(
    @Body(new ZodValidationPipe(eventSchema)) { event }: EventDto,
    @Res({ passthrough: true }) res: Response,
    @Headers(REQUEST_KEY) requestKey?: string,
  ): FsmReplyDto {
    return FsmController.send(res, this.fsm.event(event, validKey(requestKey)));
  }

  private static send(res: Response, reply: FsmReplyDto): FsmReplyDto {
    res.status(FSM_STATUS_CODES[reply.status]);
    return reply;
  }
}
