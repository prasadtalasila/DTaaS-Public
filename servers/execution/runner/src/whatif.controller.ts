import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { AccessRoute } from './auth/roles.js';
import DescriptorService from './descriptor.service.js';
import { ExecuteCommandDto, executeCommandSchema } from './dto/command.dto.js';
import { WhatIfReplyDto, WhatIfRunDto } from './dto/whatif.dto.js';
import ZodValidationPipe from './validation.pipe.js';

@Controller('whatif')
export default class WhatIfController {
  constructor(private readonly descriptor: DescriptorService) {}

  // Answers once the private copy is made; the result comes later
  @Post()
  @AccessRoute('whatif')
  @HttpCode(HttpStatus.ACCEPTED)
  ask(
    @Body(new ZodValidationPipe(executeCommandSchema)) body: ExecuteCommandDto,
  ): Promise<WhatIfReplyDto> {
    return this.descriptor.whatIfs().ask(body);
  }

  @Get(':id')
  @AccessRoute('whatif-result')
  result(@Param('id', ParseIntPipe) id: number): WhatIfRunDto {
    return this.descriptor.whatIfs().result(id);
  }
}
