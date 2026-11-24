import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { AccessRoute } from './auth/roles.js';
import DescriptorService from './descriptor.service.js';
import { SaveBody, saveSchema, SnapshotDto } from './dto/snapshot.dto.js';
import ZodValidationPipe from './validation.pipe.js';

@Controller('snapshot')
export default class SnapshotController {
  constructor(private readonly descriptor: DescriptorService) {}

  // The snapshots of the directory of runner.yaml, oldest first
  @Get()
  @AccessRoute('snapshots')
  list(): Promise<SnapshotDto[]> {
    return this.descriptor.snapshots().list();
  }

  // Answers once the save has ended; with stop, the runner then shuts
  // down
  @Post()
  @AccessRoute('save')
  save(
    @Body(new ZodValidationPipe(saveSchema)) body: SaveBody,
  ): Promise<SnapshotDto> {
    return this.descriptor.snapshots().save(body);
  }

  @Delete(':name')
  @AccessRoute('delete-snapshot')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('name') name: string): Promise<void> {
    return this.descriptor.snapshots().remove(name);
  }
}
