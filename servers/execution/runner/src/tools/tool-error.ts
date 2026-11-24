// A failure of a tool, with its exit code: 2 for a refusal before
// anything starts, 1 for a failure after
export class ToolError extends Error {
  constructor(
    message: string,
    readonly code: 1 | 2 = 2,
  ) {
    super(message);
  }
}

// A line on the output, and one on the error output
export const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

export const complain = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

// Runs a tool and sets the exit code of the process from its outcome
export async function runTool(tool: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await tool();
  } catch (error) {
    complain(`Error: ${(error as Error).message}`);
    process.exitCode = error instanceof ToolError ? error.code : 1;
  }
}
