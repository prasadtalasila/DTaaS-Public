import React, { ReactNode, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from 'react-oidc-context';
import ExecutionHistoryLoader from 'components/execution/ExecutionHistoryLoader';
import WaitNavigateAndReload from 'route/auth/WaitAndNavigate';
import { useGetAndSetUsername } from 'util/auth/Authentication';

interface PrivateRouteProps {
  children: ReactNode;
}

const PrivateRoute: React.FC<PrivateRouteProps> = ({ children }) => {
  const auth = useAuth();
  const getAndSetUsername = useGetAndSetUsername();
  let returnJSX;

  useEffect(() => {
    if (auth.isAuthenticated) {
      if (auth.user !== null && auth.user !== undefined) {
        sessionStorage.setItem('access_token', auth.user.access_token);
        getAndSetUsername(auth);
      } else {
        throw new Error('Access token was not available...');
      }
    }
  }, [auth, auth.isAuthenticated, auth.user, getAndSetUsername]);

  if (auth.isLoading) {
    returnJSX = <div>Loading...</div>;
  } else if (auth.error) {
    returnJSX = (
      <div>
        Oops... {auth.error.message}
        <WaitNavigateAndReload />
      </div>
    );
  } else if (!auth.isAuthenticated) {
    returnJSX = <Navigate to="/" replace />;
  } else if (auth.isAuthenticated) {
    // Lets all authenticated routes inform about DT status
    returnJSX = (
      <>
        {children}
        <ExecutionHistoryLoader />
      </>
    );
  } else {
    returnJSX = <Navigate to="/" replace />;
  }

  return returnJSX;
};

export default PrivateRoute;
