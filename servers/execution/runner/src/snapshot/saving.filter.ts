import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { RETRY_AFTER, SavingException } from './pause.js';

// Answers a change refused during a save with 503 and a Retry-After,
// whether the guard or a second save refused it
@Catch(SavingException)
export default class SavingFilter implements ExceptionFilter {
  catch(exception: SavingException, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', RETRY_AFTER)
      .status(exception.getStatus())
      .json(exception.getResponse());
  }
}
