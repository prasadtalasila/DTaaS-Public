/**
 * Placeholders for the host services this client does not implement yet.
 *
 * Each one is honest about it: nothing is invented, reads come back empty,
 * writes reject, and the connection reports `down`, so an extension shows
 * "not live" instead of a quiet page that looks connected. Replacing
 * `signals` with a real transport is the next step (docs/developer/client-sdk.md).
 */
import type {
  AnchorKindSpec,
  EncodingPreset,
  GitService,
  SignalsService,
  VizService,
} from '@into-cps-association/dtaas-sdk';

const notYet = (what: string) => () =>
  Promise.reject(new Error(`${what} is not available in this host yet`));

/** No transport: no samples, no history, a wall-clock playhead. */
export const stubSignals: SignalsService = {
  subscribe: () => () => undefined,
  valueAt: () => undefined,
  range: () => Promise.resolve([]),
  playhead: {
    get: () => Date.now(),
    set: () => undefined,
    follow: () => undefined,
    use: () => Date.now(),
  },
  registry: {
    search: () => Promise.resolve([]),
    get: notYet('The signal registry'),
  },
  connection: { get: () => 'down', use: () => 'down' },
};

export const stubGit: GitService = {
  read: notYet('Git access for extensions'),
  commit: notYet('Git access for extensions'),
};

/** No substrates and no stored visualisations; contributions are listed. */
export function stubViz(
  anchorKinds: readonly AnchorKindSpec[],
  presets: readonly EncodingPreset[],
): VizService {
  return {
    load: () => Promise.resolve(null),
    save: notYet('Saving a visualisation'),
    substrates: { get: notYet('Substrates'), list: () => [] },
    anchorKinds,
    presets,
  };
}
