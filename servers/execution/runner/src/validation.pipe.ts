import { PipeTransform, BadRequestException } from '@nestjs/common';
import { ZodSchema } from 'zod';
import { ExecuteCommandDto, requestKeySchema } from './dto/command.dto.js';

export const validationFailed = (): BadRequestException =>
  new BadRequestException('Validation Failed');

export function validRequestKey(requestKey?: string): string | undefined {
  if (!requestKeySchema.safeParse(requestKey).success) {
    throw validationFailed();
  }
  return requestKey;
}

export default class ZodValidationPipe implements PipeTransform {
  // eslint-disable-next-line no-empty-function, no-useless-constructor
  constructor(private schema: ZodSchema) {}

  transform(value: ExecuteCommandDto) {
    try {
      const parsedValue = this.schema.parse(value);
      return parsedValue;
    } catch (error) {
      throw validationFailed();
    }
  }
}
