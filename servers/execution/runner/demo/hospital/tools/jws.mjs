// Unwraps what the runner sends: plain JSON, or a compact JWS that the
// runner signs with auth.key, verified with its public key in
// run/keys/<id>.pub, which keygen.mjs writes beside the key. Gives
// { mark, value }, mark being verified, UNSIGNED or INVALID; a JWS that
// fails, or that no public key can check, is INVALID and has no value.
import { createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ID } from './settings.mjs';

const FILE = fileURLToPath(new URL(`../run/keys/${ID}.pub`, import.meta.url));

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url'));

// Read on each call, as a recording may write the key after it starts
function publicKey() {
  if (!existsSync(FILE)) {
    return undefined;
  }
  const x = readFileSync(FILE, 'utf8').trim();
  const jwk = { kty: 'OKP', crv: 'Ed25519', x };
  return createPublicKey({ key: jwk, format: 'jwk' });
}

// The payload of a JWS of the runner that the key verifies, or undefined
function verified(text, key) {
  const [header, payload, signature, ...rest] = text.split('.');
  try {
    const { alg, kid } = decode(header);
    const signed = Buffer.from(`${header}.${payload}`);
    const bytes = Buffer.from(signature ?? '', 'base64url');
    const ok = verify(null, signed, key, bytes);
    const valid = ok && rest.length === 0 && alg === 'Ed25519' && kid === ID;
    return valid ? decode(payload) : undefined;
  } catch {
    return undefined;
  }
}

export default function unwrap(text) {
  if (text.startsWith('{')) {
    return { mark: 'UNSIGNED', value: JSON.parse(text) };
  }
  const key = publicKey();
  const value = key && verified(text, key);
  return value === undefined
    ? { mark: 'INVALID', value }
    : { mark: 'verified', value };
}
