import { useWorkbenchLinkValues, cleanURL, useURLbasename } from 'util/envUtil';
import { useSelector } from 'react-redux';

jest.unmock('util/envUtil');

describe('envUtil', () => {
  const testAppURL = 'https://example.com';
  const testBasename = 'testBasename';
  const testUsername = 'username';
  const testAppID = 'testAppID';
  const testAuthority = 'https://example.com';
  const testScopes = 'testScopes';
  const testRedirect = 'https://example.com/redirect';
  const testLogoutRedirect = 'https://example.com';

  const testServices = {
    desktop: {
      name: 'Desktop',
      description: 'Virtual Desktop',
      endpoint: 'tools/vnc',
    },
    vscode: {
      name: 'VS Code',
      description: 'VS Code IDE',
      endpoint: 'tools/vscode',
    },
    lab: { name: 'Jupyter Lab', description: 'Jupyter Lab', endpoint: 'lab' },
    notebook: {
      name: 'Jupyter Notebook',
      description: 'Jupyter Notebook',
      endpoint: '',
    },
  };

  globalThis.env = {
    REACT_APP_ENVIRONMENT: 'test',
    REACT_APP_URL: testAppURL,
    REACT_APP_URL_BASENAME: testBasename,

    REACT_APP_CLIENT_ID: testAppID,
    REACT_APP_AUTH_AUTHORITY: testAuthority,
    REACT_APP_GITLAB_SCOPES: testScopes,
    REACT_APP_REDIRECT_URI: testRedirect,
    REACT_APP_LOGOUT_REDIRECT_URI: testLogoutRedirect,
  };

  const mockState = {
    auth: { userName: testUsername },
    workbench: { services: testServices, status: 'succeeded' },
  };

  beforeEach(() => {
    (useSelector as jest.MockedFunction<typeof useSelector>).mockImplementation(
      (selector: (state: typeof mockState) => unknown) => selector(mockState),
    );
  });

  test('GetURL should return the correct environment variables', () => {
    expect(useURLbasename()).toBe(testBasename);
  });

  test('GetWorkbenchLinkValues should return an array', () => {
    const result = useWorkbenchLinkValues();
    expect(Array.isArray(result)).toBe(true);
  });

  test('GetWorkbenchLinkValues should return an array of objects with "key" and "link" properties', () => {
    const result = useWorkbenchLinkValues();
    expect(
      result.every(
        (el) => typeof el.key === 'string' && typeof el.link === 'string',
      ),
    ).toBe(true);
  });

  it('should construct workspace service links correctly', () => {
    const result = useWorkbenchLinkValues();
    const appURL = `${testAppURL}/${testBasename}`;

    const desktopEntry = result.find((el) => el.key === 'VNCDESKTOP');
    expect(desktopEntry?.link).toBe(
      `${appURL}/${testUsername}/${testServices.desktop.endpoint}`,
    );

    const vscodeEntry = result.find((el) => el.key === 'VSCODE');
    expect(vscodeEntry?.link).toBe(
      `${appURL}/${testUsername}/${testServices.vscode.endpoint}`,
    );

    const labEntry = result.find((el) => el.key === 'JUPYTERLAB');
    expect(labEntry?.link).toBe(
      `${appURL}/${testUsername}/${testServices.lab.endpoint}`,
    );
  });

  it('should include LIBRARY and DIGITALTWINS routes', () => {
    const result = useWorkbenchLinkValues();

    const library = result.find((el) => el.key === 'LIBRARY');
    expect(library?.link).toBe('./library');

    const digitalTwins = result.find((el) => el.key === 'DIGITALTWINS');
    expect(digitalTwins?.link).toBe('./digitaltwins');
  });

  it('should always return basename-safe relative app routes', () => {
    const result = useWorkbenchLinkValues();
    expect(result.find((el) => el.key === 'LIBRARY')?.link).toBe('./library');
    expect(result.find((el) => el.key === 'DIGITALTWINS')?.link).toBe(
      './digitaltwins',
    );
  });

  it('should return only static route links when services are empty', () => {
    const emptyState = {
      auth: { userName: testUsername },
      workbench: { services: {}, status: 'idle' },
    };
    (useSelector as jest.MockedFunction<typeof useSelector>).mockImplementation(
      (selector: (state: typeof emptyState) => unknown) => selector(emptyState),
    );

    const result = useWorkbenchLinkValues();
    const workspaceKeys = [
      'VNCDESKTOP',
      'VSCODE',
      'JUPYTERLAB',
      'JUPYTERNOTEBOOK',
    ];
    workspaceKeys.forEach((key) => {
      expect(result.find((el) => el.key === key)).toBeUndefined();
    });
    expect(result.find((el) => el.key === 'LIBRARY')).toBeDefined();
    expect(result.find((el) => el.key === 'DIGITALTWINS')).toBeDefined();
  });

  it('cleanURL should remove leading and trailing slashes', () => {
    expect(cleanURL('/test/')).toBe('test');
    expect(cleanURL('/test')).toBe('test');
    expect(cleanURL('test/')).toBe('test');
    expect(cleanURL('test')).toBe('test');
  });

  it('still handles if basename is set to empty string', () => {
    globalThis.env.REACT_APP_URL_BASENAME = '';
    expect(useURLbasename()).toBe('');
  });
});
