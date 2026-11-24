import type { IncomingHttpHeaders } from 'node:http';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { Origin } from '../auth/caller-context.js';
import { nameSchema } from '../fsm/name.js';

// The headers of a request to a replay twin that name the principal and
// the seq that the input had in the twin; Node gives them in lower case
const BY = 'replay-by';
const SEQ = 'replay-seq';

// A seq without a principal stands for a row that no principal wrote,
// such as the notice of a peer
const originSchema = z.object({
  by: nameSchema.nullable().default(null),
  seq: z
    .string()
    .regex(/^[1-9]\d{0,15}$/, 'must be a whole number above 0')
    .transform(Number),
});

// The origin that the headers give, undefined without either; a
// malformed header, or one given twice, is refused with a 400
export function replayOrigin(headers: IncomingHttpHeaders): Origin | undefined {
  const [by, seq] = [headers[BY], headers[SEQ]];
  if (by === undefined && seq === undefined) {
    return undefined;
  }
  const result = originSchema.safeParse({ by, seq });
  if (!result.success) {
    const problems = result.error.issues.map(
      ({ path, message }) =>
        `Replay-${path[0] === 'by' ? 'By' : 'Seq'} ${message}`,
    );
    throw new BadRequestException(problems);
  }
  return result.data;
}
