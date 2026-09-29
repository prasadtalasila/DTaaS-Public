import { useSelector } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { setUserName } from 'store/auth.slice';
import snackbarReducer from 'store/snackbar.slice';
import settingsReducer from 'store/settings.slice';

const mockStore = configureStore({
  reducer: {
    auth: authReducer,
    snackbar: snackbarReducer,
    settings: settingsReducer,
  },
});

jest.mock('store/store', () => ({ __esModule: true, default: mockStore }));

// eslint-disable-next-line import/first
import {
  auth,
  library,
  loggerFor,
  resolveLibraryUrl,
  settings,
  signedIn,
  ui,
} from 'extension/platformServices';

const selectorReturns = (userName: string | undefined) =>
  (useSelector as unknown as jest.Mock).mockImplementation(
    (select: (state: { auth: { userName?: string } }) => unknown) =>
      select({ auth: { userName } }),
  );

describe('platformServices', () => {
  it('waits for sign-in before answering who the user is', async () => {
    const user = auth.user();
    const url = library.baseUrl();
    mockStore.dispatch(setUserName('Jane'));
    await expect(user).resolves.toEqual({ username: 'Jane' });
    await expect(url).resolves.toMatch(/\/mock_url_basename\/jane\/$/);
    await expect(signedIn()).resolves.toBe('Jane');
  });

  it('answers null from the hooks until the user is known', () => {
    selectorReturns(undefined);
    expect(auth.useUser()).toBeNull();
    expect(library.useBaseUrl()).toBeNull();
    selectorReturns('jane');
    expect(auth.useUser()).toEqual({ username: 'jane' });
    expect(library.useBaseUrl()).toMatch(/\/jane\/$/);
  });

  it('names the library folders an extension looks in', () => {
    expect(library.conventions.modelsDirectory).toBe('common/models');
    expect(library.conventions.digitalTwinsDirectory).toBe('digital_twins');
  });

  it('resolves library and web addresses, and refuses anything else', async () => {
    expect(resolveLibraryUrl('lib://common/a.png', 'http://h/jane/')).toBe(
      'http://h/jane/files/common/a.png',
    );
    expect(resolveLibraryUrl('https://x.org/a', 'http://h/')).toBe(
      'https://x.org/a',
    );
    expect(() => resolveLibraryUrl('file:///etc', 'http://h/')).toThrow();
    await expect(library.resolve('lib://a')).resolves.toMatch(/files\/a$/);
  });

  it('shows a snackbar through the store', () => {
    ui.snackbar('Saved', 'success');
    expect(mockStore.getState().snackbar).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({ message: 'Saved', severity: 'success' }),
        ],
      }),
    );
  });

  it('reads a setting from the store', () => {
    expect(settings.get('nonexistent')).toBeUndefined();
    const [key] = Object.keys(mockStore.getState().settings);
    expect(settings.get(key)).toEqual(
      (mockStore.getState().settings as unknown as Record<string, unknown>)[
        key
      ],
    );
  });

  it('tags every log line with the extension it came from', () => {
    const spies = (['debug', 'info', 'warn', 'error'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => undefined),
    );
    const logger = loggerFor('bim');
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    spies.forEach((spy) =>
      expect(spy).toHaveBeenCalledWith('[ext:bim]', expect.any(String)),
    );
    spies.forEach((spy) => spy.mockRestore());
  });
});
