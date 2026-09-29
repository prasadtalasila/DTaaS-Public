/**
 * One extension's pages, mounted under `/<id>/*`.
 *
 * The extension's routes are relative, so it can nest its own. Its pages are
 * `React.lazy`, which is what keeps a renderer or a WebAssembly kernel out of
 * the entry chunk; the fallback is what a person sees while it downloads.
 */
import { Suspense, use, useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useAuth } from 'react-oidc-context';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import {
  HostProvider,
  type DtaasExtension,
} from '@into-cps-association/dtaas-sdk';
import NotFound from 'page/NotFound';
import ExtensionPage from 'extension/ExtensionPage';
import { servicesFor, setupOutcome } from 'extension/hostServices';
import { useGetAndSetUsername } from 'util/auth/Authentication';

interface Props {
  readonly ext: DtaasExtension;
}

/**
 * The library address is built from the signed-in user name, which the store
 * only holds after this runs, as on the Library and Digital Twins pages.
 */
function useSignedInUserName() {
  const auth = useAuth();
  const getAndSetUsername = useGetAndSetUsername();
  useEffect(() => {
    getAndSetUsername(auth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user]);
}

function ExtensionPages({ ext }: Props) {
  const outcome = use(setupOutcome(ext));
  if (!outcome.ok) {
    return (
      <ExtensionPage title={ext.name}>
        <Alert severity="error">
          {ext.name} could not start. The browser console says why.
        </Alert>
      </ExtensionPage>
    );
  }
  return (
    <Routes>
      {(ext.routes ?? []).map(({ path, element: Page }) =>
        path === '' ? (
          <Route key={path} index element={<Page />} />
        ) : (
          <Route key={path} path={path} element={<Page />} />
        ),
      )}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function ExtensionRoutes({ ext }: Props) {
  useSignedInUserName();
  return (
    <HostProvider services={servicesFor(ext)}>
      <Suspense fallback={<CircularProgress sx={{ m: 4 }} />}>
        <ExtensionPages ext={ext} />
      </Suspense>
    </HostProvider>
  );
}

export default ExtensionRoutes;
