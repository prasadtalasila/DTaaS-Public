/**
 * The extensions this build and this deployment run, decided once at start.
 *
 * Pure: it reads the manifest and `env.js` and nothing else, so the menu, the
 * routes and the store can import it without importing each other.
 */
import extensions from 'extensions';
import { createExtensionHost } from 'extension/createExtensionHost';

const extensionHost = createExtensionHost(extensions, globalThis.env ?? {});

extensionHost.rejected.forEach(({ id, reasons }) => {
  // eslint-disable-next-line no-console
  console.warn(`Extension "${id}" is not loaded:`, reasons.join('; '));
});

export default extensionHost;
