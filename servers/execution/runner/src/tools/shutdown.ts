import type ReplayTwin from './replay-twin.js';
import type TwinClient from './twin-client.js';

// A runner that shuts down waits for its scripts, so stop them first;
// a twin that no longer answers is stopped all the same
export async function shutDown(twin: ReplayTwin, client: TwinClient) {
  if (twin.running()) {
    await client
      .json({ method: 'POST', path: '/stop', body: {} })
      .catch(() => undefined);
  }
  await twin.stop();
}

const CODES = { SIGINT: 130, SIGTERM: 143 } as const;

// The child and its scripts end with the tool, on a signal too; the
// kill at exit is the last resort. Returns the undoing.
export function stopWith(twin: ReplayTwin, client: TwinClient): () => void {
  const kill = () => twin.kill();
  const handlers = Object.entries(CODES).map(([signal, code]) => {
    const handler = () => {
      void shutDown(twin, client).finally(() => process.exit(code));
    };
    process.once(signal, handler);
    return [signal, handler] as const;
  });
  process.once('exit', kill);
  return () => {
    process.off('exit', kill);
    handlers.forEach(([signal, handler]) => process.off(signal, handler));
  };
}
