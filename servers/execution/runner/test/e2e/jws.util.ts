import { KeyObject } from 'node:crypto';
import { parseJws } from 'src/auth/jws';
import { verifiedPayload } from 'test/sign.util';

// The JSON a payload of the runner carries: the payload itself when it
// is plain JSON, or that of a compact JWS, parsed by the runner's own
// parseJws. With a key, only a JWS that the key signed is taken.
export function unwrap(text: string, key?: KeyObject): unknown {
  if (key !== undefined) {
    return verifiedPayload(text, key);
  }
  return text.startsWith('{') ? JSON.parse(text) : parseJws(text).payload;
}

// The protected header of a compact JWS
export const jwsHeader = (text: string): unknown => parseJws(text).header;
