// What a refusal at start prints: its message and that of its cause,
// without a stack trace
export function startFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const { cause } = error;
  return cause instanceof Error
    ? `${error.message}: ${cause.message}`
    : error.message;
}
