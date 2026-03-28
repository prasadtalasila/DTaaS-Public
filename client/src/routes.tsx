import WorkBench from 'route/workbench/Workbench';
import LayoutPublic from 'page/LayoutPublic';
import PrivateRoute from 'route/auth/PrivateRoute';
import Library from 'route/library/cart/LibraryPreview';
import DigitalTwins from 'preview/route/digitaltwins/DigitalTwinsPreview';
import SignIn from 'route/auth/Signin';
import Account from 'route/account/Account';
import Config from 'route/config/Config';
import Measurement from 'route/measurement/Measurement';

export const routes = [
  {
    path: '/',
    element: (
      <LayoutPublic>
        <SignIn />
      </LayoutPublic>
    ),
  },
  {
    path: 'config/developer',
    element: (
      <LayoutPublic containerMaxWidth="md">
        <Config role="developer" />
      </LayoutPublic>
    ),
  },
  {
    path: 'config/user',
    element: (
      <LayoutPublic containerMaxWidth="md">
        <Config role="user" />
      </LayoutPublic>
    ),
  },
  {
    path: 'library',
    element: (
      <PrivateRoute>
        <Library />
      </PrivateRoute>
    ),
  },
  {
    path: 'digitaltwins',
    element: (
      <PrivateRoute>
        <DigitalTwins />
      </PrivateRoute>
    ),
  },
  {
    path: 'account',
    element: (
      <PrivateRoute>
        <Account />
      </PrivateRoute>
    ),
  },
  {
    path: 'workbench',
    element: (
      <PrivateRoute>
        <WorkBench />
      </PrivateRoute>
    ),
  },
  {
    path: 'insight/measure',
    element: (
      <PrivateRoute>
        <Measurement />
      </PrivateRoute>
    ),
  },
];

export default routes;
