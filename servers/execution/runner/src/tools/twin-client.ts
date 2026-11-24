import { randomBytes } from 'node:crypto';
import Signer from '../auth/signer.js';
import { bodyHash } from '../auth/claims.js';
import { ToolError } from './tool-error.js';

export type Call = {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
};

type Bound = { method: string; path: string; text?: string };

// The claims that bind a token to one request, for 30 s
function claims(aud: string, { method, path, text }: Bound) {
  const iat = Math.floor(Date.now() / 1000);
  const jti = randomBytes(16).toString('base64url');
  const bh = bodyHash(Buffer.from(text ?? ''));
  const htu = path.split('?')[0];
  return { aud, iat, exp: iat + 30, jti, htm: method, htu, bh };
}

const typeOf = (text?: string): Record<string, string> =>
  text === undefined ? {} : { 'Content-Type': 'application/json' };

// Calls the replay twin over HTTP, each request signed as its principal;
// a lost connection ends the replay
export default class TwinClient {
  constructor(
    private readonly base: string,
    private readonly aud: string,
    private readonly signer: Signer,
  ) {}

  async call({ method, path, body, headers }: Call): Promise<Response> {
    // undefined without a body
    const text = JSON.stringify(body) as string | undefined;
    const token = this.signer.encode(claims(this.aud, { method, path, text }));
    const authorization = { Authorization: `Bearer ${token}` };
    try {
      return await fetch(`${this.base}${path}`, {
        method,
        headers: { ...headers, ...typeOf(text), ...authorization },
        body: text,
      });
    } catch (error) {
      throw new ToolError(`The replay twin can not be reached: ${error}`, 1);
    }
  }

  // The JSON of a request that must succeed
  async json(call: Call): Promise<unknown> {
    const response = await this.call(call);
    if (!response.ok) {
      const reason = `${response.status} ${await response.text()}`;
      throw new ToolError(
        `The replay twin refused ${call.method} ${call.path}: ${reason}`,
        1,
      );
    }
    return response.json();
  }
}
