import * as React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import AssetBoard from 'preview/components/asset/AssetBoard';
import {
  combineReducers,
  configureStore,
  getDefaultMiddleware,
} from '@reduxjs/toolkit';
import assetsReducer, { setAssets } from 'preview/store/assets.slice';
import digitalTwinReducer, {
  setDigitalTwin,
} from 'preview/store/digitalTwin.slice';
import snackbarSlice from 'preview/store/snackbar.slice';
import { Asset } from 'preview/components/asset/Asset';
import { mockGitlabInstance } from 'test/preview/__mocks__/global_mocks';
import fileSlice, {
  FileState,
  addOrUpdateFile,
} from 'preview/store/file.slice';
import DigitalTwin from 'preview/util/gitlabDigitalTwin';

jest.mock('react-redux', () => ({
  ...jest.requireActual('react-redux'),
}));

jest.useFakeTimers();

const preSetItems: Asset[] = [{ name: 'Asset 1', path: 'path/asset1' }];

const files: FileState[] = [
  { name: 'Asset 1', content: 'content1', isModified: false },
];

const store = configureStore({
  reducer: combineReducers({
    assets: assetsReducer,
    digitalTwin: digitalTwinReducer,
    snackbar: snackbarSlice,
    files: fileSlice,
  }),
  middleware: getDefaultMiddleware({
    serializableCheck: false,
  }),
});

describe('AssetBoard Integration Tests', () => {
  const setupTest = () => {
    store.dispatch(setAssets(preSetItems));
    store.dispatch(
      setDigitalTwin({
        assetName: 'Asset 1',
        digitalTwin: new DigitalTwin('Asset 1', mockGitlabInstance),
      }),
    );
    store.dispatch(addOrUpdateFile(files[0]));
  };

  beforeEach(() => {
    setupTest();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders AssetBoard with AssetCardExecute', () => {
    render(
      <Provider store={store}>
        <AssetBoard tab="Execute" error={null} />
      </Provider>,
    );

    expect(screen.getByText('Asset 1')).toBeInTheDocument();
  });

  it('renders AssetBoard with AssetCardManage', () => {
    render(
      <Provider store={store}>
        <AssetBoard tab="Manage" error={null} />
      </Provider>,
    );
    expect(screen.getByText('Asset 1')).toBeInTheDocument();
  });

  it('renders error message when error is present', () => {
    render(
      <Provider store={store}>
        <AssetBoard tab="Execute" error="An error occurred" />
      </Provider>,
    );

    expect(screen.getByText('An error occurred')).toBeInTheDocument();
  });

  it('deletes an asset', async () => {
    render(
      <Provider store={store}>
        <AssetBoard tab="Manage" error={null} />
      </Provider>,
    );

    const deleteButton = screen.getByRole('button', { name: /Delete/i });
    expect(deleteButton).toBeInTheDocument();

    act(() => {
      deleteButton.click();
    });

    const yesButton = await screen.findByRole('button', { name: /Yes/i });
    expect(yesButton).toBeInTheDocument();

    act(() => {
      yesButton.click();
    });

    await waitFor(() => {
      expect(screen.queryByText('Asset 1')).not.toBeInTheDocument();
    });
  });
});
