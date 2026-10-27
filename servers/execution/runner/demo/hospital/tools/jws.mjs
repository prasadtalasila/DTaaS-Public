// Unwraps what the runner sends: plain JSON, or a compact JWS that the
// runner signs with auth.key, verified with its public key in
// run/keys/<id>.pub, which keygen.mjs writes beside the key. Gives
// { mark, value } with mark verified or UNSIGNED, or { mark: 'INVALID',
// reason, unverified }: the reason it failed, and the payload decoded
// without a check when it can be. Standalone on purpose: it is the
// runnable form of the verifier of API.md, "Signatures".
import { createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ID } from './settings.mjs';

const FILE = fileURLToPath(new URL(`../run/keys/${ID}.pub`, import.meta.url));

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url'));

// Read on each call, as a recording may write the key after it starts;
// a file that is missing or half written is no key
function readKey() {
  if (!existsSync(FILE)) {
    return { reason: 'no key file' };
  }
  try {
    const x = readFileSync(FILE, 'utf8').trim();
    const jwk = { kty: 'OKP', crv: 'Ed25519', x };
    return { key: createPublicKey({ key: jwk, format: 'jwk' }) };
  } catch {
    return { reason: 'unreadable key file' };
  }
}

// The header of a JWS of three segments, or undefined
function header(segments) {
  try {
    return segments.length === 3 ? decode(segments[0]) : undefined;
  } catch {
    return undefined;
  }
}

// A signature of another length makes verify throw
function signedBy(segments, key) {
  const [head, payload, signature] = segments;
  const bytes = Buffer.from(signature, 'base64url');
  try {
    return verify(null, Buffer.from(`${head}.${payload}`), key, bytes);
  } catch {
    return false;
  }
}

// Why the JWS fails, the first check that does, or undefined when the
// key verifies it
function failure(segments, { key, reason }) {
  const { alg, kid } = header(segments) ?? {};
  const checks = [
    [() => alg === undefined, 'malformed'],
    [() => key === undefined, reason],
    [() => alg !== 'Ed25519', `wrong alg ${alg}`],
    [() => kid !== ID, `wrong kid ${kid}`],
    [() => !signedBy(segments, key), 'bad signature'],
  ];
  return checks.find(([fails]) => fails())?.[1];
}

// The payload decoded without a check, or undefined
function peek(segments) {
  try {
    return decode(segments[1]);
  } catch {
    return undefined;
  }
}

// Plain JSON, such as a notification or the array of a history reply,
// or undefined; a JWS never parses as JSON
function plain(text) {
  try {
    return { mark: 'UNSIGNED', value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

export default function unwrap(text) {
  const unsigned = plain(text);
  if (unsigned !== undefined) {
    return unsigned;
  }
  const segments = text.split('.');
  const reason = failure(segments, readKey());
  return reason === undefined
    ? { mark: 'verified', value: decode(segments[1]) }
    : { mark: 'INVALID', reason, unverified: peek(segments) };
}

// One line of the logs: the mark and the summary, or for an INVALID
// message the reason and the payload as it came, marked unverified
export function marked(text, label, describe) {
  const { mark, value, reason, unverified } = unwrap(text);
  if (mark !== 'INVALID') {
    return `${mark.padEnd(8)} ${label} ${describe(value)}`;
  }
  const shown = JSON.stringify(unverified ?? null);
  return `INVALID  ${label} (${reason}) unverified ${shown}`;
}
