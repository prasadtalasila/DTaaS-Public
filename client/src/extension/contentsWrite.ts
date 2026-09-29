/**
 * Writing a file to the workspace through the Jupyter Contents API.
 *
 * Moved from `route/bim/persistGeometry.ts`, where it stored browser-converted
 * building models, and generalised to any path an extension writes.
 *
 * A file is written with a PUT to `api/contents/<path>` whose body carries the
 * bytes as base64. A Jupyter server can guard writes with a token it sets as
 * the `_xsrf` cookie and expects echoed in the `X-XSRFToken` header, so the
 * token is sent when the cookie is readable. Every request is credentialed,
 * exactly as the reads are.
 *
 * Why the write is split
 * ----------------------
 * A large file sent as one request makes the workspace close the connection
 * part way through. The Contents API takes a file in pieces instead: the body
 * carries a `chunk` number, the server truncates and writes on chunk one,
 * appends on the ones after it, and runs its post-save hooks on `chunk: -1`.
 * That is what JupyterLab's own uploader does. The pieces have to arrive in
 * order, so they are sent one after another and never together.
 *
 * Why the bytes go to another name first
 * --------------------------------------
 * A write in pieces can stop part way: the tab is closed, the connection
 * drops. Pieces written straight to the real name would leave half a file
 * under it. So every write goes to `<path>.part` and takes its real name with
 * a rename once the last piece has landed. A write that fails deletes its
 * `.part`; one the browser could not delete is truncated by the next write.
 */

const PARTIAL_SUFFIX = '.part';

/**
 * How many bytes go in one request.
 *
 * The workspace refuses a request body of a megabyte with HTTP 413. Base64
 * adds a third, so at 512 KB the body is 683 KB, which the workspace accepts;
 * the first size measured to fail was a 768 KB piece. A stricter proxy answers
 * 413, and the write is then tried once more in pieces of half this size.
 */
export const CHUNK_BYTES = 512 * 1024;

/** A write the server refused, with the status it refused it with. */
export class UploadError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`${url} returned HTTP ${status}`);
  }
}

/** The XSRF token the Jupyter server set, or undefined when there is none. */
export function readXsrfToken(): string | undefined {
  const match = /(?:^|;\s*)_xsrf=([^;]+)/.exec(document.cookie);
  return match ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Base64 of the bytes, built in chunks: spreading a large array into
 * `String.fromCodePoint` at once overflows the call stack.
 */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += CHUNK) {
    const slice = bytes.subarray(index, index + CHUNK);
    binary += String.fromCodePoint(...slice);
  }
  return btoa(binary);
}

export function writeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = readXsrfToken();
  if (token) headers['X-XSRFToken'] = token;
  return headers;
}

async function request(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, { credentials: 'include', ...init });
  if (!response.ok) throw new UploadError(url, response.status);
}

/** Best effort: a `.part` that stays is truncated by the next write. */
async function discard(url: string, headers: Record<string, string>) {
  try {
    await fetch(url, { method: 'DELETE', credentials: 'include', headers });
  } catch {
    // Nothing more to do. The next write starts the file over.
  }
}

const putPiece = (
  url: string,
  headers: Record<string, string>,
  bytes: Uint8Array,
  chunk?: number,
) =>
  request(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      type: 'file',
      format: 'base64',
      content: toBase64(bytes),
      ...(chunk === undefined ? {} : { chunk }),
    }),
  });

async function sendPieces(
  url: string,
  headers: Record<string, string>,
  bytes: Uint8Array,
  pieceBytes: number,
) {
  // One that fits is sent without a chunk number: chunk one truncates, and
  // nothing would then mark the end and run the post-save hooks.
  if (bytes.length <= pieceBytes) {
    await putPiece(url, headers, bytes);
    return;
  }
  const pieces = Math.ceil(bytes.length / pieceBytes);
  for (let index = 0; index < pieces; index += 1) {
    const slice = bytes.subarray(index * pieceBytes, (index + 1) * pieceBytes);
    // Counted from one; -1 tells the server the file is complete.
    const chunk = index === pieces - 1 ? -1 : index + 1;
    // The server appends as each piece lands, so they cannot be sent together.
    // eslint-disable-next-line no-await-in-loop
    await putPiece(url, headers, slice, chunk);
  }
}

async function sendAll(
  url: string,
  headers: Record<string, string>,
  bytes: Uint8Array,
) {
  try {
    await sendPieces(url, headers, bytes, CHUNK_BYTES);
  } catch (error) {
    // Once, at half the size. Chunk one truncates, so starting over is safe.
    if (!(error instanceof UploadError) || error.status !== 413) throw error;
    await sendPieces(url, headers, bytes, CHUNK_BYTES / 2);
  }
}

/**
 * Write `bytes` to `url` (an `api/contents/<path>` address) through a `.part`
 * file. With `replace`, a file already at `url` is deleted just before the
 * rename, because the server refuses to rename onto a taken name.
 */
export async function writeFile(
  url: string,
  path: string,
  bytes: Uint8Array,
  replace: boolean,
): Promise<void> {
  const headers = writeHeaders();
  const partialUrl = `${url}${PARTIAL_SUFFIX}`;
  try {
    await sendAll(partialUrl, headers, bytes);
    if (replace) await discard(url, headers);
    await request(partialUrl, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ path }),
    });
  } catch (error) {
    await discard(partialUrl, headers);
    throw error;
  }
}
