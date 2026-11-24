import { describe, expect, it } from '@jest/globals';
import { startFailure } from 'src/config/start-failure';

describe('A refusal at start', () => {
  it('Should be the message of the error', () => {
    expect(startFailure(new Error('Can not start a replay twin'))).toBe(
      'Can not start a replay twin',
    );
  });

  it('Should add the message of the cause', () => {
    const cause = new Error('ENOENT: no such file');

    expect(startFailure(new Error('Invalid configuration', { cause }))).toBe(
      'Invalid configuration: ENOENT: no such file',
    );
  });

  it('Should print what is not an error as it is', () => {
    expect(startFailure('stopped')).toBe('stopped');
  });
});
