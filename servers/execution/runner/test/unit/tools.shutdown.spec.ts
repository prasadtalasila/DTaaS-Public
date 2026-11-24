import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type ReplayTwin from 'src/tools/replay-twin';
import type TwinClient from 'src/tools/twin-client';
import { shutDown, stopWith } from 'src/tools/shutdown';

// A replay twin that runs until stopped, and a client whose POST /stop
// never answers
const fakes = () => {
  const twin = {
    running: () => true,
    stop: jest.fn(async () => undefined),
    kill: jest.fn(),
  };
  const client = {
    json: jest.fn<(call: unknown) => Promise<unknown>>(
      () => new Promise(() => undefined),
    ),
  };
  return [twin, client] as unknown as [
    ReplayTwin & typeof twin,
    TwinClient & typeof client,
  ];
};

const SIGNALS = ['SIGINT', 'SIGTERM'] as const;

describe('The shutdown of runner-replay', () => {
  const before = SIGNALS.map((signal) => process.listeners(signal));

  afterEach(() => {
    SIGNALS.forEach((signal, index) => {
      process
        .listeners(signal)
        .filter((listener) => !before[index].includes(listener))
        .forEach((listener) => process.off(signal, listener));
    });
    jest.restoreAllMocks();
  });

  it('Should stop the twin when POST /stop does not answer in time', async () => {
    const [twin, client] = fakes();

    await shutDown(twin, client, 10);

    expect(client.json).toHaveBeenCalledWith({
      method: 'POST',
      path: '/stop',
      body: {},
    });
    expect(twin.stop).toHaveBeenCalled();
  });

  it('Should kill the twin at a second signal, and end', async () => {
    const [twin, client] = fakes();
    client.json.mockResolvedValue({});
    const exit = jest
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    const undo = stopWith(twin, client);

    process.emit('SIGINT');
    process.emit('SIGTERM');
    undo();
    await new Promise(setImmediate);

    expect(twin.kill).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(143);
    expect(exit).toHaveBeenCalledWith(130);
  });
});
