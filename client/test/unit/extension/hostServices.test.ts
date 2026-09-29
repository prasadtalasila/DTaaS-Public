import { z } from 'zod';
import type { DtaasExtension } from '@into-cps-association/dtaas-sdk';

jest.mock('extensions', () => ({ __esModule: true, default: [] }));
jest.mock('store/store', () => ({
  __esModule: true,
  default: { getState: () => ({ auth: {} }), subscribe: () => () => undefined },
}));

// eslint-disable-next-line import/first
import { servicesFor, setupOutcome } from 'extension/hostServices';
// eslint-disable-next-line import/first
import { stubGit, stubSignals } from 'extension/stubServices';

const kit = (
  id: string,
  extra: Partial<DtaasExtension> = {},
): DtaasExtension => ({
  id,
  name: id,
  version: '1.0.0',
  sdk: 1,
  ...extra,
});

describe('servicesFor', () => {
  afterEach(() => {
    delete globalThis.env.REACT_APP_EXT_ALPHA_URL;
  });

  it('gives each extension one services object, kept across calls', () => {
    const alpha = kit('alpha');
    expect(servicesFor(alpha)).toBe(servicesFor(alpha));
    expect(servicesFor(alpha)).not.toBe(servicesFor(kit('beta')));
  });

  it("reads only that extension's env.js keys", () => {
    globalThis.env.REACT_APP_EXT_ALPHA_URL = 'https://example.org';
    const schema = z.object({ url: z.string() });
    expect(servicesFor(kit('alpha')).config(schema)).toEqual({
      url: 'https://example.org',
    });
    expect(() => servicesFor(kit('gamma')).config(schema)).toThrow();
  });

  it('hands out the placeholder signals and git', () => {
    const host = servicesFor(kit('alpha'));
    expect(host.signals).toBe(stubSignals);
    expect(host.git).toBe(stubGit);
    expect(host.viz.substrates.list()).toEqual([]);
  });
});

describe('setupOutcome', () => {
  it('runs setup once with the extension services', async () => {
    const setup = jest.fn();
    const ext = kit('once', { setup });
    await expect(setupOutcome(ext)).resolves.toEqual({ ok: true });
    await setupOutcome(ext);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledWith(servicesFor(ext));
  });

  it('reports a failed setup instead of rejecting', async () => {
    const error = new Error('boom');
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const outcome = await setupOutcome(
      kit('broken', {
        setup: () => {
          throw error;
        },
      }),
    );
    expect(outcome).toEqual({ ok: false, error });
    expect(spy).toHaveBeenCalledWith('[ext:broken]', 'setup failed', error);
    spy.mockRestore();
  });
});
