/**
 * The parts of `HostServices` this client already had in some form: who is
 * signed in, where their library is, the snackbar, the page frame, logging
 * and settings. Each is a thin adapter over the store or `env.js`, so an
 * extension never imports either.
 */
import { useSelector } from 'react-redux';
import type {
  AuthService,
  LibraryService,
  Logger,
  SettingsService,
  UiService,
} from '@into-cps-association/dtaas-sdk';
import store, { type RootState } from 'store/store';
import { showSnackbar } from 'store/snackbar.slice';
import { libraryURLfor } from 'util/envUtil';
import { DT_DIRECTORY } from 'model/backend/gitlab/digitalTwinConfig/constants';
import ExtensionPage from 'extension/ExtensionPage';

const currentUser = () => store.getState().auth.userName;

/** Resolves with the user name once sign-in has put it in the store. */
export function signedIn(): Promise<string> {
  return new Promise((resolve) => {
    const known = currentUser();
    if (known) {
      resolve(known);
      return;
    }
    const unsubscribe = store.subscribe(() => {
      const name = currentUser();
      if (name) {
        unsubscribe();
        resolve(name);
      }
    });
  });
}

const useUserName = () =>
  useSelector((state: RootState) => state.auth.userName);

export const auth: AuthService = {
  user: async () => ({ username: await signedIn() }),
  useUser: () => {
    const name = useUserName();
    return name ? { username: name } : null;
  },
};

/** `lib://<path>` is a file in the user's library; http(s) passes through. */
export function resolveLibraryUrl(url: string, base: string): string {
  if (url.startsWith('lib://')) {
    return `${base.replace(/\/+$/, '')}/files/${url.slice('lib://'.length)}`;
  }
  if (/^https?:\/\//.test(url)) return url;
  throw new Error(`Cannot resolve "${url}"`);
}

const baseUrl = async () => libraryURLfor(await signedIn());

export const library: LibraryService = {
  baseUrl,
  useBaseUrl: () => {
    const name = useUserName();
    return name ? libraryURLfor(name) : null;
  },
  conventions: {
    modelsDirectory: 'common/models',
    digitalTwinsDirectory: DT_DIRECTORY,
    visualisationsDirectory: 'common/visualisations',
  },
  resolve: async (url) => resolveLibraryUrl(url, await baseUrl()),
};

export const ui: UiService = {
  snackbar: (message, severity) => {
    store.dispatch(showSnackbar({ message, severity }));
  },
  Page: ExtensionPage,
};

export const settings: SettingsService = {
  get: <T>(key: string) =>
    (store.getState().settings as unknown as Record<string, unknown>)[key] as
      T | undefined,
};

/** The browser console, each line tagged with the extension it came from. */
export function loggerFor(id: string): Logger {
  const tag = `[ext:${id}]`;
  /* eslint-disable no-console */
  return {
    debug: (...args) => console.debug(tag, ...args),
    info: (...args) => console.info(tag, ...args),
    warn: (...args) => console.warn(tag, ...args),
    error: (...args) => console.error(tag, ...args),
  };
  /* eslint-enable no-console */
}
