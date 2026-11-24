import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { runTool, ToolError } from 'src/tools/tool-error';

describe('A tool', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it('Should exit with the code of a refusal, and 1 for any other error', async () => {
    const write = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    await runTool(() => Promise.reject(new ToolError('no snapshot')));
    const refused = process.exitCode;
    await runTool(() => Promise.reject(new Error('lost')));
    const failed = process.exitCode;
    await runTool(() => Promise.resolve(0));
    const lines = write.mock.calls.map(([text]) => String(text));
    write.mockRestore();

    expect([refused, failed, process.exitCode]).toEqual([2, 1, 0]);
    expect(lines).toEqual(['Error: no snapshot\n', 'Error: lost\n']);
  });
});
