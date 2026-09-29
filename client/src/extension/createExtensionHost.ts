/**
 * The registry of compiled-in extensions.
 *
 * `validateExtension` from the SDK checks one extension on its own. The rules
 * here are the ones only the host can apply: what this deployment switched
 * off, whether the deployment's `env.js` keys satisfy the extension, and
 * whether two extensions claim the same name. A rejected extension gets no
 * route and no menu entry, so its address shows the Not Found page.
 */
import {
  isExtensionDisabled,
  readExtensionConfig,
  validateExtension,
  type DtaasExtension,
  type EnvRecord,
} from '@into-cps-association/dtaas-sdk';

export interface RejectedExtension {
  readonly id: string;
  readonly reasons: readonly string[];
}

export interface ExtensionHost {
  readonly enabled: readonly DtaasExtension[];
  readonly rejected: readonly RejectedExtension[];
}

function ownReasons(ext: DtaasExtension, env: EnvRecord): string[] {
  if (isExtensionDisabled(ext.id, env)) {
    return ['switched off by REACT_APP_EXTENSIONS_DISABLED'];
  }
  const { errors } = validateExtension(ext);
  if (errors.length > 0) return errors;
  // Mounting `state.ext.<id>` is not built yet; saying so beats a reducer
  // that is silently never called.
  if (ext.reducer) return ['reducers are not supported by this host yet'];
  const config =
    ext.config && readExtensionConfig(ext.id, ext.config.schema, env);
  return config && !config.success
    ? [`invalid configuration: ${config.error.message}`]
    : [];
}

/** Every name an extension claims that no other extension may claim too. */
function claims(ext: DtaasExtension): string[] {
  const viz = ext.visualisation;
  return [
    `extension id "${ext.id}"`,
    ...(viz?.anchorKinds ?? []).map(({ kind }) => `anchor kind "${kind}"`),
    ...(viz?.presets ?? []).map(({ id }) => `preset "${id}"`),
    ...(viz?.substrates ?? []).map(({ id }) => `substrate "${id}"`),
  ];
}

/** Extensions listed later lose a clash, so the manifest order decides. */
export function createExtensionHost(
  extensions: readonly DtaasExtension[],
  env: EnvRecord,
): ExtensionHost {
  const claimed = new Set<string>();
  const enabled: DtaasExtension[] = [];
  const rejected: RejectedExtension[] = [];
  extensions.forEach((ext) => {
    const own = ownReasons(ext, env);
    const clashes = claims(ext)
      .filter((name) => claimed.has(name))
      .map((name) => `${name} is already registered`);
    const reasons = own.length > 0 ? own : clashes;
    if (reasons.length > 0) {
      rejected.push({ id: ext.id, reasons });
      return;
    }
    claims(ext).forEach((name) => claimed.add(name));
    enabled.push(ext);
  });
  return { enabled, rejected };
}
