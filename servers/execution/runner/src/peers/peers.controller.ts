import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
} from '@nestjs/common';
import { AccessRoute } from '../auth/roles.js';
import DescriptorService from '../descriptor.service.js';
import { PeersBody, peersBodySchema, PeersDto } from '../dto/peers.dto.js';
import { NoticeBody, noticeBodySchema } from '../replay/notice.js';
import ZodValidationPipe from '../validation.pipe.js';

@Controller('peers')
export default class PeersController {
  constructor(private readonly descriptor: DescriptorService) {}

  @Get()
  @AccessRoute('peers')
  get(): PeersDto {
    return this.descriptor.peers().document();
  }

  // Enables and disables listed peers; the route is idempotent, so it
  // takes no request key
  @Put()
  @AccessRoute('set-peers')
  set(@Body(new ZodValidationPipe(peersBodySchema)) body: PeersBody): PeersDto {
    const problems = this.descriptor.peers().set(body);
    if (problems.length > 0) {
      throw new BadRequestException(problems);
    }
    return this.get();
  }

  // A notice of a peer, handed to a replay twin as if it arrived over
  // MQTT; the access guard answers 404 in any other runner
  @Put(':id/notice')
  @AccessRoute('notice')
  notice(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(noticeBodySchema)) body: NoticeBody,
  ): PeersDto {
    const peers = this.descriptor.peers();
    if (!Object.hasOwn(peers.document(), id)) {
      throw new BadRequestException([`unknown peer ${id}`]);
    }
    peers.observe(id, body.kind, body.data);
    return this.get();
  }
}
