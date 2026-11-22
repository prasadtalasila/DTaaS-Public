import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpStatus,
  Put,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { Caller, CallerInfo } from './auth/caller.js';
import { AccessRoute } from './auth/roles.js';
import DescriptorService from './descriptor.service.js';
import { fsmReply, FsmReplyDto } from './dto/fsm.dto.js';
import {
  PropertiesBody,
  propertiesBodySchema,
  PropertiesDto,
} from './dto/properties.dto.js';
import ZodValidationPipe from './validation.pipe.js';

@Controller('properties')
export default class PropertiesController {
  constructor(private readonly descriptor: DescriptorService) {}

  // Without a state machine file, the reply of GET /fsm
  @Get()
  @AccessRoute('properties')
  get(@Res({ passthrough: true }) res: Response): PropertiesDto | FsmReplyDto {
    const document = this.descriptor.properties().document();
    if (document === undefined) {
      res.status(HttpStatus.NOT_FOUND);
      return fsmReply('no state machine', undefined);
    }
    return document;
  }

  // Takes the latest values that scripts and sensors hand the runner;
  // the route is idempotent, so it takes no request key
  @Put()
  @AccessRoute('set-properties')
  set(
    @Body(new ZodValidationPipe(propertiesBodySchema)) body: PropertiesBody,
    @Caller() { by }: CallerInfo,
    @Res({ passthrough: true }) res: Response,
  ): PropertiesDto | FsmReplyDto {
    const problems = this.descriptor.properties().set(body, by);
    if (problems.length > 0) {
      throw new BadRequestException(problems);
    }
    return this.get(res);
  }
}
