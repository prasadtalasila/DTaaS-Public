import { KeyObject, verify } from 'node:crypto';

const decode = (segment: string): unknown =>
  JSON.parse(Buffer.from(segment, 'base64url').toString());

// Whether the text is a compact JWS that the key signed with Ed25519
function verifies(text: string, key: KeyObject): boolean {
  const [header, payload, signature, ...rest] = text.split('.');
  const { alg } = decode(header) as { alg?: unknown };
  const input = Buffer.from(`${header}.${payload}`);
  const bytes = Buffer.from(signature ?? '', 'base64url');
  return (
    rest.length === 0 && alg === 'Ed25519' && verify(null, input, key, bytes)
  );
}

// The JSON a payload of the runner carries: the payload of a compact
// JWS, or the payload itself when it is plain JSON. With a key, only a
// JWS that the key signed is taken.
export function unwrap(text: string, key?: KeyObject): unknown {
  if (key === undefined) {
    return text.startsWith('{') ? JSON.parse(text) : decode(text.split('.')[1]);
  }
  if (!verifies(text, key)) {
    throw new Error('not verified');
  }
  return decode(text.split('.')[1]);
}

// The protected header of a compact JWS
export const jwsHeader = (text: string): unknown => decode(text.split('.')[0]);
