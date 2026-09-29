/**
 * Writing a file through the Jupyter Contents API: the XSRF token, the base64
 * body, the pieces a large file is split into, the `.part` name the bytes go
 * to first, and the clean-up when the server refuses.
 */
import {
  CHUNK_BYTES,
  readXsrfToken,
  toBase64,
  UploadError,
  writeFile,
} from 'extension/contentsWrite';

const target = 'http://localhost/jane/api/contents/common/models/a.glb';
const partial = `${target}.part`;
const path = 'common/models/a.glb';
const small = new Uint8Array([1, 2, 3, 4]);

type Answer = { ok: boolean; status: number };
type Call = [
  string,
  { method: string; body?: string; headers?: Record<string, string> },
];

/** A workspace that accepts everything unless told otherwise. */
const workspace = (
  answers: { put?: Answer | ((index: number) => Answer); patch?: Answer } = {},
) => {
  let puts = 0;
  const mock = jest.fn((_url: string, init: { method: string }) => {
    if (init.method === 'PUT') {
      puts += 1;
      const put = answers.put ?? { ok: true, status: 201 };
      return Promise.resolve(typeof put === 'function' ? put(puts) : put);
    }
    if (init.method === 'PATCH') {
      return Promise.resolve(answers.patch ?? { ok: true, status: 200 });
    }
    return Promise.resolve({ ok: true, status: 204 });
  });
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
};

const callsOf = (mock: jest.Mock, method: string) =>
  (mock.mock.calls as Call[]).filter(([, init]) => init.method === method);

const bodiesOf = (mock: jest.Mock) =>
  callsOf(mock, 'PUT').map(([, init]) => JSON.parse(init.body as string));

afterEach(() => {
  document.cookie = '_xsrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  jest.restoreAllMocks();
});

describe('readXsrfToken', () => {
  it('reads and decodes the token the server set', () => {
    document.cookie = `_xsrf=${encodeURIComponent('a b/c')}`;
    expect(readXsrfToken()).toBe('a b/c');
  });

  it('returns undefined when there is no token', () => {
    expect(readXsrfToken()).toBeUndefined();
  });
});

describe('toBase64', () => {
  it('encodes the bytes', () => {
    expect(toBase64(new Uint8Array([73, 70, 67]))).toBe('SUZD');
  });

  it('encodes an array larger than one chunk without overflowing', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 5).fill(65);
    expect(atob(toBase64(bytes))).toHaveLength(bytes.length);
  });
});

describe('writeFile', () => {
  it('writes to the partial name with the token, then renames', async () => {
    document.cookie = '_xsrf=tok';
    const mock = workspace();

    await writeFile(target, path, small, false);

    const methods = (mock.mock.calls as Call[]).map(([, init]) => init.method);
    expect(methods).toEqual(['PUT', 'PATCH']);
    const [[url, init]] = callsOf(mock, 'PUT');
    expect(url).toBe(partial);
    expect(init.headers?.['X-XSRFToken']).toBe('tok');
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'file',
      format: 'base64',
      content: toBase64(small),
    });
    const [rename] = callsOf(mock, 'PATCH');
    expect(rename[0]).toBe(partial);
    expect(JSON.parse(rename[1].body as string)).toEqual({ path });
  });

  it('sends no XSRF header when the workspace sets no token', async () => {
    const mock = workspace();
    await writeFile(target, path, small, false);
    expect(callsOf(mock, 'PUT')[0][1].headers?.['X-XSRFToken']).toBeUndefined();
  });

  it('deletes the file at the real name before renaming when replacing', async () => {
    const mock = workspace();
    await writeFile(target, path, small, true);
    const methods = (mock.mock.calls as Call[]).map(([, init]) => init.method);
    expect(methods).toEqual(['PUT', 'DELETE', 'PATCH']);
    expect(callsOf(mock, 'DELETE')[0][0]).toBe(target);
  });

  it('sends a large file in ordered pieces, with the last one marked', async () => {
    const large = new Uint8Array(CHUNK_BYTES * 2 + 512).fill(7);
    const mock = workspace();

    await writeFile(target, path, large, false);

    const bodies = bodiesOf(mock);
    expect(bodies.map((body) => body.chunk)).toEqual([1, 2, -1]);
    const sent = bodies.reduce(
      (sum, body) => sum + atob(body.content).length,
      0,
    );
    expect(sent).toBe(large.length);
  });

  it('sends a file that fits in one request without a chunk number', async () => {
    const mock = workspace();
    await writeFile(target, path, new Uint8Array(CHUNK_BYTES), false);
    expect(bodiesOf(mock)).toHaveLength(1);
    expect(bodiesOf(mock)[0].chunk).toBeUndefined();
  });

  it('tries once more in pieces of half the size after a 413', async () => {
    const mock = workspace({
      put: (index) =>
        index === 1 ? { ok: false, status: 413 } : { ok: true, status: 201 },
    });

    await writeFile(target, path, new Uint8Array(CHUNK_BYTES + 1), false);

    expect(bodiesOf(mock).map((body) => body.chunk)).toEqual([1, 1, 2, -1]);
    expect(callsOf(mock, 'PATCH')).toHaveLength(1);
  });

  it('gives up when the smaller pieces are refused as well', async () => {
    const mock = workspace({ put: { ok: false, status: 413 } });
    await expect(
      writeFile(target, path, new Uint8Array(CHUNK_BYTES + 1), false),
    ).rejects.toThrow(/HTTP 413/);
    expect(callsOf(mock, 'PUT')).toHaveLength(2);
    expect(callsOf(mock, 'PATCH')).toHaveLength(0);
  });

  it('stops at a refused piece and deletes the partial file', async () => {
    const mock = workspace({
      put: (index) =>
        index === 1 ? { ok: true, status: 201 } : { ok: false, status: 500 },
    });

    await expect(
      writeFile(target, path, new Uint8Array(CHUNK_BYTES * 3), false),
    ).rejects.toThrow(UploadError);
    expect(callsOf(mock, 'PUT')).toHaveLength(2);
    expect(callsOf(mock, 'DELETE').map(([url]) => url)).toEqual([partial]);
  });

  it('rejects when the rename is refused, and deletes the partial file', async () => {
    const mock = workspace({ patch: { ok: false, status: 409 } });
    await expect(writeFile(target, path, small, false)).rejects.toThrow(
      /a\.glb\.part returned HTTP 409/,
    );
    expect(callsOf(mock, 'DELETE')).toHaveLength(1);
  });

  it('still rejects with the write error when the clean-up fails', async () => {
    globalThis.fetch = jest.fn((_url: string, init: { method: string }) =>
      init.method === 'DELETE'
        ? Promise.reject(new TypeError('down'))
        : Promise.resolve({ ok: false, status: 403 }),
    ) as unknown as typeof fetch;

    await expect(writeFile(target, path, small, false)).rejects.toThrow(
      /HTTP 403/,
    );
  });
});
