import type { IncomingHttpHeaders } from 'node:http';
import { BadRequestException } from '@nestjs/common';
import type { Origin } from '../auth/caller-context.js';
import { nameSchema } from '../fsm/name.js';

// The headers of a request to a replay twin that name the principal and
// the seq that the input had in the twin; Node gives them in lower case
const BY = 'replay-by';
const SEQ = 'replay-seq';

const SEQ_FORM = /^[1-9]\d{0,15}$/;

// A 400 that says which header is wrong and what it must be
const problem = (message: string) => new BadRequestException([message]);

function single(header: string, value?: string | string[]) {
  if (Array.isArray(value)) {
    throw problem(`${header} is given twice: give it once`);
  }
  return value;
}

function seqOf(value?: string): number {
  if (value === undefined) {
    throw problem(
      'Replay-Seq is missing: Replay-By needs it, a whole number above 0',
    );
  }
  if (!SEQ_FORM.test(value)) {
    throw problem(
      `Replay-Seq must be a whole number above 0, not ${JSON.stringify(value)}`,
    );
  }
  return Number(value);
}

// A seq without a principal stands for a row that no principal wrote,
// such as the notice of a peer
function byOf(value?: string): string | null {
  if (value !== undefined && !nameSchema.safeParse(value).success) {
    throw problem(
      `Replay-By must be the name of a principal, up to 64 letters, digits, _, . or -, from a letter, not ${JSON.stringify(value)}`,
    );
  }
  return value ?? null;
}

// The origin that the headers give, undefined without either; a
// malformed header, or one given twice, is refused with a 400
export function replayOrigin(headers: IncomingHttpHeaders): Origin | undefined {
  const by = single('Replay-By', headers[BY]);
  const seq = single('Replay-Seq', headers[SEQ]);
  if (by === undefined && seq === undefined) {
    return undefined;
  }
  return { by: byOf(by), seq: seqOf(seq) };
}
