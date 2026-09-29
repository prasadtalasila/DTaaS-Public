import type { DtaasExtension } from '@into-cps-association/dtaas-sdk';
import { extension as bim } from '@into-cps-association/bim-example/dtaas';

/**
 * Every domain extension compiled into this build.
 *
 * Adding one: add the package to `package.json` and import it here. Removing
 * one: the reverse. A deployment hides a compiled-in extension without a
 * rebuild through `env.js`: `REACT_APP_EXTENSIONS_DISABLED: 'bim'`.
 * `docs/developer/client-sdk.md` describes the contract.
 */
const extensions: readonly DtaasExtension[] = [bim];

export default extensions;
