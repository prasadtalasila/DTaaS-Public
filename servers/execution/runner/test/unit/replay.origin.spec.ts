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
    [{ 'replay-by': 'manager-1' }],
    [{ 'replay-by': 'manager-1', 'replay-seq': '0' }],
    [{ 'replay-by': 'manager-1', 'replay-seq': '1.5' }],
    [{ 'replay-by': 'manager-1', 'replay-seq': 'x' }],
    [{ 'replay-by': 'a b', 'replay-seq': '3' }],
    [{ 'replay-by': 'manager-1', 'replay-seq': ['3', '4'] }],
  ])('Should refuse malformed headers %j', (headers) => {
    expect(refused(headers)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Replay-(By|Seq) /)]),
    );
  });
});
