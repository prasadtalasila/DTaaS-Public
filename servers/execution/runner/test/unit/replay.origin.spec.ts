import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { replayOrigin } from 'src/replay/origin';

// The problems of the 400 that the headers get
function refused(headers: Record<string, string | string[]>): unknown {
  try {
    replayOrigin(headers);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (
      (error as BadRequestException).getResponse() as { message: unknown }
    ).message;
  }
  return 'accepted';
}

describe('The origin headers of a request to a replay twin', () => {
  it('Should give no origin without the headers', () => {
    expect(replayOrigin({ host: 'localhost' })).toBeUndefined();
  });

  it('Should give the principal and the seq', () => {
    expect(
      replayOrigin({ 'replay-by': 'manager-1', 'replay-seq': '42' }),
    ).toEqual({ by: 'manager-1', seq: 42 });
  });

  it('Should take a seq without a principal, for a row that none wrote', () => {
    expect(replayOrigin({ 'replay-seq': '7' })).toEqual({ by: null, seq: 7 });
  });

  it.each([
    [
      { 'replay-by': 'manager-1' },
      'Replay-Seq is missing: Replay-By needs it, a whole number above 0',
    ],
    [
      { 'replay-by': 'manager-1', 'replay-seq': '0' },
      'Replay-Seq must be a whole number above 0, not "0"',
    ],
    [
      { 'replay-by': 'manager-1', 'replay-seq': '1.5' },
      'Replay-Seq must be a whole number above 0, not "1.5"',
    ],
    [
      { 'replay-seq': 'x' },
      'Replay-Seq must be a whole number above 0, not "x"',
    ],
    [
      { 'replay-by': 'a b', 'replay-seq': '3' },
      'Replay-By must be the name of a principal, up to 64 letters, digits, _, . or -, from a letter, not "a b"',
    ],
    [
      { 'replay-by': 'manager-1', 'replay-seq': ['3', '4'] },
      'Replay-Seq is given twice: give it once',
    ],
    [
      { 'replay-by': ['a', 'b'], 'replay-seq': '3' },
      'Replay-By is given twice: give it once',
    ],
  ])(
    'Should refuse malformed headers %j, saying which and why',
    (headers, message) => {
      expect(refused(headers)).toEqual([message]);
    },
  );
});
