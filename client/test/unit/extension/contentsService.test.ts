import {
  createContentsService,
  isWorkspacePath,
} from 'extension/contentsService';

const base = 'http://localhost/jane/';
const contents = createContentsService(() => Promise.resolve(base));

const answer = (status: number, body: unknown = {}) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new Uint8Array([9, 8]).buffer),
  });

const mockFetch = (respond: (url: string, method: string) => unknown) => {
  const mock = jest.fn((url: string, init?: { method?: string }) =>
    respond(url, init?.method ?? 'GET'),
  );
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
};

afterEach(() => jest.restoreAllMocks());

describe('isWorkspacePath', () => {
  it.each(['', 'common', 'common/models/a b.glb'])('accepts "%s"', (path) => {
    expect(isWorkspacePath(path)).toBe(true);
  });

  it.each([
    ['escapes the workspace', 'common/../../secrets'],
    ['is absolute', '/etc/passwd'],
    ['uses a backslash', 'common\\a'],
    ['has an empty segment', 'common//a'],
    ['has a dot segment', 'common/./a'],
    ['ends in a slash', 'common/'],
  ])('refuses a path that %s', (_reason, path) => {
    expect(isWorkspacePath(path)).toBe(false);
  });
});

describe('createContentsService', () => {
  it('lists a folder as contents entries, credentialed', async () => {
    const mock = mockFetch(() =>
      answer(200, {
        content: [
          {
            name: 'a.ifc',
            path: 'm/a.ifc',
            type: 'file',
            size: 3,
            last_modified: 't',
          },
          { name: 'sub', path: 'm/sub', type: 'directory', size: null },
          { name: 'n.ipynb', path: 'm/n.ipynb', type: 'notebook' },
        ],
      }),
    );

    await expect(contents.list('m')).resolves.toEqual([
      {
        name: 'a.ifc',
        path: 'm/a.ifc',
        type: 'file',
        size: 3,
        lastModified: 't',
      },
      { name: 'sub', path: 'm/sub', type: 'directory' },
      { name: 'n.ipynb', path: 'm/n.ipynb', type: 'file' },
    ]);
    expect(mock).toHaveBeenCalledWith('http://localhost/jane/api/contents/m', {
      credentials: 'include',
    });
  });

  it('encodes each path segment', async () => {
    const mock = mockFetch(() => answer(200, { content: [] }));
    await contents.list('my models/a#b');
    expect(mock.mock.calls[0][0]).toBe(
      'http://localhost/jane/api/contents/my%20models/a%23b',
    );
  });

  it('reads a file as bytes from the files endpoint', async () => {
    const mock = mockFetch(() => answer(200));
    await expect(contents.get('m/a.glb')).resolves.toEqual(
      new Uint8Array([9, 8]),
    );
    expect(mock.mock.calls[0][0]).toBe('http://localhost/jane/files/m/a.glb');
  });

  it('rejects a read the server refuses', async () => {
    mockFetch(() => answer(403));
    await expect(contents.get('m/a.glb')).rejects.toThrow(/HTTP 403/);
  });

  it('tells a missing file from a present one, and fails on anything else', async () => {
    mockFetch(() => answer(404));
    await expect(contents.exists('m/a.glb')).resolves.toBe(false);
    mockFetch(() => answer(200));
    await expect(contents.exists('m/a.glb')).resolves.toBe(true);
    mockFetch(() => answer(500));
    await expect(contents.exists('m/a.glb')).rejects.toThrow(/HTTP 500/);
  });

  it('refuses a path outside the workspace before sending anything', async () => {
    const mock = mockFetch(() => answer(200));
    await expect(contents.list('../etc')).rejects.toThrow(/not a path/);
    await expect(contents.put('a/../../b', new Uint8Array())).rejects.toThrow(
      /not a path/,
    );
    await expect(contents.put('', new Uint8Array())).rejects.toThrow(/root/);
    expect(mock).not.toHaveBeenCalled();
  });

  it('writes and replaces by default', async () => {
    const mock = mockFetch(() => answer(200));
    await contents.put('m/a.glb', new Uint8Array([1]));
    expect(mock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual([
      'PUT',
      'DELETE',
      'PATCH',
    ]);
  });

  it('refuses to replace a file when overwrite is false', async () => {
    const mock = mockFetch(() => answer(200));
    await expect(
      contents.put('m/a.glb', new Uint8Array([1]), { overwrite: false }),
    ).rejects.toThrow(/already exists/);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('writes a new file without deleting anything when overwrite is false', async () => {
    const mock = mockFetch((_url, method) =>
      answer(method === 'GET' ? 404 : 201),
    );
    await contents.put('m/a.glb', new Uint8Array([1]), { overwrite: false });
    expect(mock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual([
      'GET',
      'PUT',
      'PATCH',
    ]);
  });
});
