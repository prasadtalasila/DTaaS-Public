import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { CommandStatus } from './interfaces/command.interface.js';
import ExecaManager from './execa-manager.service.js';
import DescriptorService from './descriptor.service.js';
import { DescriptorDto } from './dto/descriptor.dto.js';
import {
  EscalateBody,
  EscalateReplyDto,
  escalateSchema,
} from './dto/escalation.dto.js';
import { StateDocumentDto } from './dto/state.dto.js';
import {
  ExecuteCommandDto,
  executeCommandSchema,
  executeResponse,
  REQUEST_KEY,
  StopDto,
  stopSchema,
  StopResponseDto,
} from './dto/command.dto.js';
import ZodValidationPipe, { validRequestKey } from './validation.pipe.js';
import FsmService from './fsm/fsm.service.js';

@Controller()
export default class AppController {
  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly manager: ExecaManager,
    private readonly descriptor: DescriptorService,
    private readonly fsm: FsmService,
  ) {} // eslint-disable-line no-empty-function

  @Get('dt')
  describe(): DescriptorDto {
    return this.descriptor.describe();
  }

  @Get('state')
  state(): StateDocumentDto {
    return this.descriptor.state();
  }

  @Get('history')
  getHistory(): Array<ExecuteCommandDto> {
    return this.manager.checkHistory();
  }

  @Post()
  async newCommand(
    @Body(new ZodValidationPipe(executeCommandSchema))
    executeCommandDto: ExecuteCommandDto,
    @Res({ passthrough: true }) res: Response,
    @Headers(REQUEST_KEY) requestKey?: string,
  ): Promise<void> {
    const { name } = executeCommandDto;
    const [outcome] = await this.manager.newCommand(
      name,
      validRequestKey(requestKey),
      { env: this.fsm.environment(name) },
    );
    res
      .status(outcome === 'failed' ? HttpStatus.BAD_REQUEST : HttpStatus.OK)
      .send(executeResponse(outcome));
  }

  // Answers once the stopped scripts have exited
  @Post('stop')
  @HttpCode(HttpStatus.OK)
  async stop(
    @Body(new ZodValidationPipe(stopSchema)) { name }: StopDto,
  ): Promise<StopResponseDto> {
    return { stopped: await this.manager.stop(name) };
  }

  // Accepted with or without a state machine
  @Post('escalate')
  @HttpCode(HttpStatus.ACCEPTED)
  escalate(
    @Body(new ZodValidationPipe(escalateSchema)) body: EscalateBody,
    @Headers(REQUEST_KEY) requestKey?: string,
  ): EscalateReplyDto {
    return this.fsm.escalate(body, validRequestKey(requestKey));
  }

  @Get()
  async cmdStatus(): Promise<CommandStatus> {
    return this.manager.checkStatus();
  }
}
