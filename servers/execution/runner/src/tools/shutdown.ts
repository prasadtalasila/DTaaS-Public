import { setTimeout as delay } from 'node:timers/promises';
import type ReplayTwin from './replay-twin.js';
import type TwinClient from './twin-client.js';

// How long the shutdown waits for the answer to POST /stop
const STOP_LIMIT = 10000;

// A runner that shuts down waits for its scripts, so stop them first;
// a twin that no longer answers, or not in time, is stopped all the same
export async function shutDown(
  twin: ReplayTwin,
  client: TwinClient,
  limit = STOP_LIMIT,
) {
  if (twin.running()) {
    const stopped = client
      .json({ method: 'POST', path: '/stop', body: {} })
      .catch(() => undefined);
    // an unref timer does not keep the tool alive
    await Promise.race([stopped, delay(limit, undefined, { ref: false })]);
  }
  await twin.stop();
}

const CODES = { SIGINT: 130, SIGTERM: 143 } as const;
type Signal = keyof typeof CODES;

// A second signal during the shutdown kills the twin, and the tool ends
function killOnSecond(twin: ReplayTwin): void {
  (Object.keys(CODES) as Signal[]).forEach((signal) =>
    process.once(signal, () => {
      twin.kill();
      process.exit(CODES[signal]);
    }),
  );
}

// The child and its scripts end with the tool, on a signal too; the
// kill at exit is the last resort. Returns the undoing.
export function stopWith(twin: ReplayTwin, client: TwinClient): () => void {
  const kill = () => twin.kill();
  const handlers = Object.entries(CODES).map(([signal, code]) => {
    const handler = () => {
      killOnSecond(twin);
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
