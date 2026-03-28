# End-to-End (E2E) Tests

The E2E tests require the Playwright test runner and an on-premise GitLab
OAuth setup.
The <https://gitlab.com> service uses CAPTCHA protection, which blocks
automated end-to-end tests.
An on-premise or third-party GitLab instance without CAPTCHA protection is
therefore required.

Make sure you have an active internet connection while running these tests,
as the tests simulate real user interactions with your GitLab account.

There are two possible testing setups you can create.

1. Host website on the developer computer and test from developer computer.
   This is the default E2E testing scenario.
   The DTaaS client application runs at `http://localhost:4000`.
1. Host the website on the integration server and run tests from the
   integration server.
   The DTaaS client application runs at `https://intocps.org`.

The following sections describe configuration and yarn test commands for
both these scenarios.

## Install Playwright

The E2E tests use playwright test runner. You also need to have the software
installed. If it is not installed, you can install it with the following command.

```bash
yarn playwright install --with-deps
```

## Setup Test Configuration

### OAuth Setup

Follow the instructions on the
[authorisation page](../../docs/admin/client/auth.md) to configure OAuth for
the React client website.
The correct callback URL must be added to the OAuth application.
Depending on the location of the client website, register one of the
following callback URLs.

| Location of client application | URL                     |
| :----------------------------- | :---------------------- |
| Localhost                      | `http://localhost:4000` |
| External / Integration server  | `https://intocps.org`   |

The GitLab will still be running on a remote machine.
It is not possible to run both the GitLab and react client website on localhost.

### Client Configuration

Before running the E2E tests, you need to update
the client configuration file available at `config/test.js`.

Make sure the configuration in `config/test.js` matches
the details of your testing environment. For instance, you need to adjust:

- `REACT_APP_URL`
- `REACT_APP_AUTH_AUTHORITY`
- `REACT_APP_REDIRECT_URI`
- `REACT_APP_LOGOUT_REDIRECT_URI`

to reflect the selected test setup.
Additional information on environment settings is available in the
[authorisation](../../docs/admin/client/auth.md) and
[client configuration](../../docs/admin/client/config.md) pages.

Here's an example of relevant values for variables. This example is suitable for
testing on developer computer, i.e., `localhost`.

```js
window.env = {
  REACT_APP_ENVIRONMENT: 'dev',
  REACT_APP_URL: 'http://localhost:4000/',
  REACT_APP_URL_BASENAME: '',
  REACT_APP_URL_DTLINK: '/lab',
  REACT_APP_URL_LIBLINK: '',
  REACT_APP_WORKBENCHLINK_VNCDESKTOP: '/tools/vnc/?password=vncpassword',
  REACT_APP_WORKBENCHLINK_VSCODE: '/tools/vscode/',
  REACT_APP_WORKBENCHLINK_JUPYTERLAB: '/lab',
  REACT_APP_WORKBENCHLINK_JUPYTERNOTEBOOK: '',
  REACT_APP_WORKBENCHLINK_LIBRARY_PREVIEW: '/library',
  REACT_APP_WORKBENCHLINK_DT_PREVIEW: '/digitaltwins',

  REACT_APP_CLIENT_ID:
    '934b98f03f1b6f743832b2840bf7cccaed93c3bfe579093dd0942a433691ccc0',
  REACT_APP_AUTH_AUTHORITY: 'https://gitlab.intocps.org/',
  REACT_APP_REDIRECT_URI: 'http://localhost:4000/library',
  REACT_APP_LOGOUT_REDIRECT_URI: 'http://localhost:4000/',
  REACT_APP_GITLAB_SCOPES: 'openid profile read_user read_repository api',
};
```

The corresponding values for running the DTaaS client application on an integration
server hosted at `https://intocps.org` are:

```js
window.env = {
  REACT_APP_ENVIRONMENT: 'dev',
  REACT_APP_URL: 'https://intocps.org/',
  REACT_APP_URL_BASENAME: '',
  REACT_APP_URL_DTLINK: '/lab',
  REACT_APP_URL_LIBLINK: '',
  REACT_APP_WORKBENCHLINK_VNCDESKTOP: '/tools/vnc/?password=vncpassword',
  REACT_APP_WORKBENCHLINK_VSCODE: '/tools/vscode/',
  REACT_APP_WORKBENCHLINK_JUPYTERLAB: '/lab',
  REACT_APP_WORKBENCHLINK_JUPYTERNOTEBOOK: '',
  REACT_APP_WORKBENCHLINK_LIBRARY_PREVIEW: '/library',
  REACT_APP_WORKBENCHLINK_DT_PREVIEW: '/digitaltwins',

  REACT_APP_CLIENT_ID:
    '934b98f03f1b6f743832b2840bf7cccaed93c3bfe579093dd0942a433691ccc0',
  REACT_APP_AUTH_AUTHORITY: 'https://gitlab.intocps.org/',
  REACT_APP_REDIRECT_URI: 'https://intocps.org/library',
  REACT_APP_LOGOUT_REDIRECT_URI: 'https://intocps.org/',
  REACT_APP_GitLab_SCOPES: 'openid profile read_user read_repository api',
};
```

### Test User Credentials

You need to create a test environment file named `test/.env`
in which you will store the GitLab user credentials and
the DTaaS application URL for the website. The credentials will be
used by playwright to simulate real user interactions during the E2E tests.

A template for `test/.env` for running the DTaaS client application
on the developer computer, i.e., `localhost` is given here:

```env
REACT_APP_TEST_USERNAME=your_username
REACT_APP_TEST_PASSWORD=your_password
REACT_APP_URL='http://localhost:4000'
PRIMARY_RUNNER=your_primary_gitlab_runner_tag
SECONDARY_RUNNER=your_secondary_gitlab_runner_tag
```

Replace _your_username_ and _your_password_ with the actual username and password
for the selected on-premise GitLab account (`gitlab.intocps.org`) or test account.
If you do not have a secondary gitlab runner, you can use the same one for both.
They will be the ones used in the e2e tests for executing twins and taking
measurements.

Here's an example `test/.env` for test setup on the developer machine and
and the DTaaS client application running on a remote integration server:

```env
REACT_APP_TEST_USERNAME=TestUsername
REACT_APP_TEST_PASSWORD=TestPassword123
REACT_APP_URL='https://intocps.org'
PRIMARY_RUNNER=linux
SECONDARY_RUNNER=windows
```

Here, `https://intocps.org` is the application URL.
Replace _intocps.org_ with the actual application URL.

## Run Tests

### Localhost

You can run the end-to-end tests as follows:

```bash
yarn install
yarn build
yarn config:test
yarn test:e2e
```

The `yarn test:e2e` command launches the test runner, the DTaaS client application
and execute all end-to-end tests.
The client application is terminated at the end of end-to-end tests.

## Testing on the integration server

In this setup, the DTaaS application runs at `https://intocps.org` and
the GitLab instance runs at `https://gitlab.intocps.org`.
The E2E tests are executed from the developer computer.
The same codebase commit should be used on both the developer computer
and integration server.

Points to note:

1. To run tests on the integration server, disable HTTPS authorisation
   (if configured) on the Traefik server and make the website
   accessible without authentication by the
   [Traefik forward auth](../../docs/admin/servers/auth.md) service.
1. Tests from the developer computer to the integration server work only
   with a null basename.
   Tests fail if a basename (for example, `au`) is specified.
   This appears to be caused by interaction between the developer computer,
   Traefik gateway, and the client website hosted behind Traefik.

You can run the end-to-end tests as follows:

```bash
yarn install
yarn test:e2e:ext
```
