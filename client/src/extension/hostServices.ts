/**
 * One `HostServices` per extension, and each extension's `setup`, run once.
 *
 * Per extension because `config()` must read that extension's own
 * `REACT_APP_EXT_<ID>_*` keys and `logger` must tag its lines. Everything
 * else is shared.
 */
import {
  readExtensionConfig,
  type DtaasExtension,
  type HostServices,
} from '@into-cps-association/dtaas-sdk';
import { createContentsService } from 'extension/contentsService';
import {
  auth,
  library,
  loggerFor,
  settings,
  ui,
} from 'extension/platformServices';
import extensionHost from 'extension/registry';
import { stubGit, stubSignals, stubViz } from 'extension/stubServices';

const contents = createContentsService(library.baseUrl);

const viz = stubViz(
  extensionHost.enabled.flatMap((ext) => ext.visualisation?.anchorKinds ?? []),
  extensionHost.enabled.flatMap((ext) => ext.visualisation?.presets ?? []),
);

function createHostServices(ext: DtaasExtension): HostServices {
  return {
    auth,
    library,
    contents,
    git: stubGit,
    signals: stubSignals,
    viz,
    ui,
    logger: loggerFor(ext.id),
    settings,
    config: (schema) => {
      const result = readExtensionConfig(ext.id, schema, globalThis.env ?? {});
      if (!result.success) throw result.error;
      return result.data;
    },
  };
}

const services = new Map<string, HostServices>();

export function servicesFor(ext: DtaasExtension): HostServices {
  let found = services.get(ext.id);
  if (!found) {
    found = createHostServices(ext);
    services.set(ext.id, found);
  }
  return found;
}

export interface SetupOutcome {
  readonly ok: boolean;
  readonly error?: unknown;
}

const outcomes = new Map<string, Promise<SetupOutcome>>();

/** Runs `setup` the first time it is asked for; never rejects. */
export function setupOutcome(ext: DtaasExtension): Promise<SetupOutcome> {
  let outcome = outcomes.get(ext.id);
  if (!outcome) {
    const host = servicesFor(ext);
    outcome = Promise.resolve()
      .then(() => ext.setup?.(host))
      .then(
        () => ({ ok: true }),
        (error: unknown) => {
          host.logger.error('setup failed', error);
          return { ok: false, error };
        },
      );
    outcomes.set(ext.id, outcome);
  }
  return outcome;
}

/** Start every enabled extension, once the store exists. */
export function startExtensions(): void {
  extensionHost.enabled.forEach((ext) => {
    setupOutcome(ext);
  });
}
