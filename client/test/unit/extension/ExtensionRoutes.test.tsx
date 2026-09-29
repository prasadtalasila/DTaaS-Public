import { lazy } from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useHost, type DtaasExtension } from '@into-cps-association/dtaas-sdk';

jest.mock('extensions', () => ({ __esModule: true, default: [] }));
jest.mock('react-oidc-context', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('util/auth/Authentication', () => ({
  useGetAndSetUsername: () => jest.fn(),
}));
jest.mock('store/store', () => ({
  __esModule: true,
  default: { getState: () => ({ auth: {} }), subscribe: () => () => undefined },
}));

// eslint-disable-next-line import/first
import ExtensionRoutes from 'extension/ExtensionRoutes';

function Models() {
  return <p>models in {useHost().library.conventions.modelsDirectory}</p>;
}

function Model() {
  return <p>one model</p>;
}

const kit = (
  id: string,
  extra: Partial<DtaasExtension> = {},
): DtaasExtension => ({
  id,
  name: `Kit ${id}`,
  version: '1.0.0',
  sdk: 1,
  routes: [
    { path: '', element: lazy(async () => ({ default: Models })) },
    { path: 'models/:model', element: lazy(async () => ({ default: Model })) },
  ],
  ...extra,
});

const renderAt = (ext: DtaasExtension, path: string) =>
  act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={`${ext.id}/*`} element={<ExtensionRoutes ext={ext} />} />
        </Routes>
      </MemoryRouter>,
    );
  });

describe('ExtensionRoutes', () => {
  it('renders the index page with the host services in context', async () => {
    await renderAt(kit('alpha'), '/alpha');
    expect(
      await screen.findByText('models in common/models'),
    ).toBeInTheDocument();
  });

  it('renders a nested route of the extension', async () => {
    await renderAt(kit('beta'), '/beta/models/Substation');
    expect(await screen.findByText('one model')).toBeInTheDocument();
  });

  it('answers an address the extension does not define with Not Found', async () => {
    await renderAt(kit('gamma'), '/gamma/nowhere');
    expect(
      await screen.findByText('This Page Does Not Exist'),
    ).toBeInTheDocument();
  });

  it('says so when the extension failed to start', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = kit('delta', {
      setup: () => Promise.reject(new Error('boom')),
    });
    await renderAt(broken, '/delta');
    expect(
      await screen.findByText(
        'Kit delta could not start. The browser console says why.',
      ),
    ).toBeInTheDocument();
  });
});
