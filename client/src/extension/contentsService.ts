/**
 * `HostServices.contents`: the signed-in user's workspace files, through the
 * Jupyter Contents API the Library page and the old Buildings route used.
 *
 * Every path is relative to the workspace root and is checked before it
 * reaches a credentialed request: a `..` segment in a PUT writes wherever it
 * points. The address itself is assembled by the application from its own
 * deployment configuration and the signed-in user name, which is what makes
 * sending credentials to it acceptable.
 */
import type {
  ContentsEntry,
  ContentsService,
  PutOptions,
} from '@into-cps-association/dtaas-sdk';
import { UploadError, writeFile } from 'extension/contentsWrite';
import { cleanURL } from 'util/envUtil';

/** Relative, no `\`, and no empty, `.` or `..` segment. `''` is the root. */
export function isWorkspacePath(path: string): boolean {
  if (path === '') return true;
  if (path.startsWith('/') || path.includes('\\')) return false;
  return path
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function checked(path: string): string {
  if (!isWorkspacePath(path)) {
    throw new Error(`"${path}" is not a path inside the workspace`);
  }
  return path.split('/').map(encodeURIComponent).join('/');
}

const address = (base: string, api: string, path: string) =>
  `${cleanURL(base)}/${api}/${checked(path)}`;

interface JupyterEntry {
  name: string;
  path: string;
  type: string;
  size?: number | null;
  last_modified?: string;
}

const toEntry = (entry: JupyterEntry): ContentsEntry => ({
  name: entry.name,
  path: entry.path,
  type: entry.type === 'directory' ? 'directory' : 'file',
  ...(entry.size == null ? {} : { size: entry.size }),
  ...(entry.last_modified ? { lastModified: entry.last_modified } : {}),
});

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new UploadError(url, response.status);
  return response;
}

/** Only a 404 means free; any other answer might be a file. */
async function exists(url: string): Promise<boolean> {
  const response = await fetch(`${url}?content=0`, { credentials: 'include' });
  if (response.status === 404) return false;
  if (!response.ok) throw new UploadError(url, response.status);
  return true;
}

/** `baseUrl` resolves to the workspace address once the user is known. */
export function createContentsService(
  baseUrl: () => Promise<string>,
): ContentsService {
  const contents = async (path: string) =>
    address(await baseUrl(), 'api/contents', path);
  return {
    async list(path) {
      const response = await fetchOk(await contents(path));
      const body = (await response.json()) as { content?: JupyterEntry[] };
      return (body.content ?? []).map(toEntry);
    },
    async get(path) {
      const url = address(await baseUrl(), 'files', path);
      const response = await fetchOk(url);
      return new Uint8Array(await response.arrayBuffer());
    },
    exists: async (path) => exists(await contents(path)),
    async put(path, bytes, options: PutOptions = {}) {
      if (path === '') throw new Error('cannot write the workspace root');
      const url = await contents(path);
      const replace = options.overwrite !== false;
      if (!replace && (await exists(url))) {
        throw new Error(`${path} already exists`);
      }
      await writeFile(url, path, bytes, replace);
    },
  };
}
