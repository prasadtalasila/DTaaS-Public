import { Controller, Get, Query, Req } from '@nestjs/common';
import type { CallerRequest } from './auth/access.guard.js';
import { AccessRoute } from './auth/roles.js';
import DescriptorService from './descriptor.service.js';
import {
  TimelineCount,
  TimelineQuery,
  timelineQuerySchema,
  timelineReply,
  TimelineRow,
} from './dto/timeline.dto.js';
import ZodValidationPipe from './validation.pipe.js';

@Controller('timeline')
export default class TimelineController {
  constructor(private readonly descriptor: DescriptorService) {}

  // What entered the DT, changed in it and left it, oldest first; a
  // reader pages with after, the seq of the last row that it has
  @Get()
  @AccessRoute('timeline')
  get(
    @Query(new ZodValidationPipe(timelineQuerySchema)) query: TimelineQuery,
    @Req() { principal }: CallerRequest,
  ): TimelineRow[] | TimelineCount {
    return timelineReply(this.descriptor.timeline(), query, principal);
  }
}
