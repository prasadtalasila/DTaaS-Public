import { z } from 'zod';
import type { DtaasExtension } from '@into-cps-association/dtaas-sdk';
import { createExtensionHost } from 'extension/createExtensionHost';

const kit = (
  id: string,
  extra: Partial<DtaasExtension> = {},
): DtaasExtension => ({
  id,
  name: id.toUpperCase(),
  version: '1.0.0',
  sdk: 1,
  ...extra,
});

const withPreset = (id: string, presetId: string) =>
  kit(id, {
    visualisation: {
      detect: () => false,
      presets: [
        {
          id: presetId,
          label: presetId,
          substrate: 'image',
          encodings: [],
        },
      ],
    },
  });

const idsOf = (list: readonly { id: string }[]) => list.map(({ id }) => id);

describe('createExtensionHost', () => {
  it('enables every valid extension, in manifest order', () => {
    const host = createExtensionHost([kit('alpha'), kit('beta')], {});
    expect(idsOf(host.enabled)).toEqual(['alpha', 'beta']);
    expect(host.rejected).toEqual([]);
  });

  it('enables nothing from an empty manifest', () => {
    expect(createExtensionHost([], {})).toEqual({ enabled: [], rejected: [] });
  });

  it('drops an extension the deployment switched off', () => {
    const host = createExtensionHost([kit('alpha'), kit('beta')], {
      REACT_APP_EXTENSIONS_DISABLED: 'beta, gamma',
    });
    expect(idsOf(host.enabled)).toEqual(['alpha']);
    expect(host.rejected[0].reasons[0]).toMatch(
      /REACT_APP_EXTENSIONS_DISABLED/,
    );
  });

  it('drops an extension the SDK rejects, with its reasons', () => {
    const host = createExtensionHost([kit('library')], {});
    expect(host.enabled).toEqual([]);
    expect(host.rejected[0].id).toBe('library');
    expect(host.rejected[0].reasons.length).toBeGreaterThan(0);
  });

  it('drops an extension whose env.js keys fail its schema', () => {
    const config = { schema: z.object({ url: z.string().url() }) };
    const host = createExtensionHost([kit('alpha', { config })], {
      REACT_APP_EXT_ALPHA_URL: 'not a url',
    });
    expect(host.enabled).toEqual([]);
    expect(host.rejected[0].reasons[0]).toMatch(/invalid configuration/);
  });

  it('keeps an extension whose env.js keys pass its schema', () => {
    const config = { schema: z.object({ url: z.string().url() }) };
    const host = createExtensionHost([kit('alpha', { config })], {
      REACT_APP_EXT_ALPHA_URL: 'https://example.org',
    });
    expect(idsOf(host.enabled)).toEqual(['alpha']);
  });

  it('drops an extension that ships a reducer, which is not mounted yet', () => {
    const host = createExtensionHost(
      [kit('alpha', { reducer: (state = 0) => state })],
      {},
    );
    expect(host.rejected[0].reasons).toEqual([
      'reducers are not supported by this host yet',
    ]);
  });

  it('keeps the first of two extensions with the same id', () => {
    const first = kit('alpha');
    const host = createExtensionHost([first, kit('alpha')], {});
    expect(host.enabled).toEqual([first]);
    expect(host.rejected[0].reasons).toEqual([
      'extension id "alpha" is already registered',
    ]);
  });

  it('drops the later of two extensions claiming the same preset', () => {
    const host = createExtensionHost(
      [withPreset('alpha', 'heat'), withPreset('beta', 'heat')],
      {},
    );
    expect(idsOf(host.enabled)).toEqual(['alpha']);
    expect(host.rejected[0].reasons).toEqual([
      'preset "heat" is already registered',
    ]);
  });

  it('does not let a rejected extension block a later one', () => {
    const host = createExtensionHost(
      [kit('alpha'), kit('alpha', { version: '' }), kit('beta')],
      {},
    );
    expect(idsOf(host.enabled)).toEqual(['alpha', 'beta']);
  });
});
