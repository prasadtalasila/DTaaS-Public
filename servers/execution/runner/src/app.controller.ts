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
import { CommandStatus } from './interfaces/command.interface.js';
import ExecaManager from './execa-manager.service.js';
import DescriptorService from './descriptor.service.js';
import { DescriptorDto } from './dto/descriptor.dto.js';
import {
  ExecuteCommandDto,
  executeCommandSchema,
  executeResponse,
  REQUEST_KEY,
} from './dto/command.dto.js';
import ZodValidationPipe, { validRequestKey } from './validation.pipe.js';

@Controller()
export default class AppController {
  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly manager: ExecaManager,
    private readonly descriptor: DescriptorService,
  ) {} // eslint-disable-line no-empty-function

  @Get('dt')
  describe(): DescriptorDto {
    return this.descriptor.describe();
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
    const [success] = await this.manager.newCommand(
      executeCommandDto.name,
      validRequestKey(requestKey),
    );
    res
      .status(success ? HttpStatus.OK : HttpStatus.BAD_REQUEST)
      .send(executeResponse(success));
  }

  @Get()
  async cmdStatus(): Promise<CommandStatus> {
    return this.manager.checkStatus();
  }
}
