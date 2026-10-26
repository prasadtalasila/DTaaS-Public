// Signs requests to the runner with a key of run/keys/, as the
// principals of runner.auth.yaml (see record.mjs). Without the key file
// a request goes unsigned, as the runner of runner.yaml expects.
//
//   node tools/sign.mjs http METHOD PATH [BODY]  prints "Bearer <jws>"
//   node tools/sign.mjs mqtt ROUTE [JSON]        prints the payload
//
// HTTP requests sign as alice and MQTT requests as manager-1; DT_AS
// names another principal. DT_ID, DT_BASE and DT_KEYS (a directory)
// replace the demo's id, base topic and run/keys/ for another runner.
import { createHash, createPrivateKey, randomBytes, sign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE as DEMO_BASE, ID as DEMO_ID } from './settings.mjs';

const ID = process.env.DT_ID ?? DEMO_ID;
const BASE = process.env.DT_BASE ?? DEMO_BASE;
const KEYS =
  process.env.DT_KEYS ??
  fileURLToPath(new URL('../run/keys/', import.meta.url));

const segment = (value) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

// A compact JWS of the claims, bound to the DT for 30 s
function token(name, claims) {
  const file = join(KEYS, `${name}.key`);
  if (!existsSync(file)) {
    return undefined;
  }
  const key = createPrivateKey(readFileSync(file));
  const iat = Math.floor(Date.now() / 1000);
  const jti = randomBytes(16).toString('base64url');
  const payload = { aud: ID, iat, exp: iat + 30, jti, ...claims };
  const input = `${segment({ alg: 'Ed25519', kid: name })}.${segment(payload)}`;
  const signature = sign(null, Buffer.from(input), key);
  return `${input}.${signature.toString('base64url')}`;
}

// The Authorization header of an HTTP request, or undefined
export function authorization(method, path, body = '') {
  const bh = createHash('sha256').update(body).digest('base64url');
  const jws = token(process.env.DT_AS ?? 'alice', {
    htm: method,
    htu: path,
    bh,
  });
  return jws && `Bearer ${jws}`;
}

// The payload of an MQTT request: the JWS envelope of the plain JSON,
// or the plain JSON itself without a key
export function envelope(route, json = '') {
  const body = json === '' ? undefined : JSON.parse(json);
  const topic = `${BASE}/${route}`;
  return token(process.env.DT_AS ?? 'manager-1', { topic, body }) ?? json;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [kind, ...rest] = process.argv.slice(2);
  const signed = kind === 'mqtt' ? envelope(...rest) : authorization(...rest);
  process.stdout.write(signed ?? '');
}
