import { generateKeyPairSync, KeyObject, verify } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { publicKeyObject } from 'src/auth/auth.config';
import Signer from 'src/auth/signer';

const notification = { kind: 'state', id: 'hospital-1', time: null, data: {} };

const decode = (segment: string): unknown =>
  JSON.parse(Buffer.from(segment, 'base64url').toString());

// Whether the JWS verifies with the public key the signer gives
function verifies(jws: string, signer: Signer): boolean {
  const [header, payload, signature] = jws.split('.');
  const key = publicKeyObject(String(signer.publicKey()));
  const input = Buffer.from(`${header}.${payload}`);
  return verify(null, input, key, Buffer.from(signature, 'base64url'));
}

describe('Signer', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const signer = new Signer(privateKey, 'hospital-1');

  it('Should encode plain JSON without a key', () => {
    const plain = new Signer(undefined, 'hospital-1');

    expect([plain.encode(notification), plain.publicKey()]).toEqual([
      JSON.stringify(notification),
      null,
    ]);
    expect(plain.contentType()).toBe('application/json');
  });

  it('Should encode a JWS of the same JSON with a key', () => {
    const jws = signer.encode(notification);
    const [header, payload, ...rest] = jws.split('.');

    expect(decode(header)).toEqual({ alg: 'Ed25519', kid: 'hospital-1' });
    expect(Buffer.from(payload, 'base64url').toString()).toBe(
      JSON.stringify(notification),
    );
    expect(rest).toHaveLength(1);
    expect(verifies(jws, signer)).toBe(true);
    expect(signer.contentType()).toBe('application/jose');
  });

  it('Should give a signature that a changed payload fails', () => {
    const [header, , signature] = signer.encode(notification).split('.');
    const changed = Buffer.from(
      JSON.stringify({ ...notification, id: 'hospital-2' }),
    ).toString('base64url');

    expect(verifies(`${header}.${changed}.${signature}`, signer)).toBe(false);
  });

  it('Should give its public key as the x of its JWK', () => {
    const { x } = privateKey.export({ format: 'jwk' });

    expect(signer.publicKey()).toBe(x);
  });
});

describe('Signer.load', () => {
  let dir: string;

  const write = (name: string, key: KeyObject, type: 'pkcs8' | 'spki') => {
    writeFileSync(join(dir, name), key.export({ type, format: 'pem' }));
    return name;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-signer-'));
    write('dt.key', generateKeyPairSync('ed25519').privateKey, 'pkcs8');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Should give a signer without a key without a file', () => {
    expect(Signer.load(undefined, dir, 'dt-1').publicKey()).toBeNull();
  });

  it('Should read the key relative to the directory, or absolute', () => {
    const relative = Signer.load('dt.key', dir, 'dt-1');
    const absolute = Signer.load(join(dir, 'dt.key'), '/elsewhere', 'dt-1');

    expect(relative.publicKey()).toMatch(/^[\w-]{43}$/);
    expect(absolute.publicKey()).toBe(relative.publicKey());
  });

  it.each([
    ['a missing file', () => 'missing.key'],
    [
      'an RSA key',
      () =>
        write(
          'rsa.key',
          generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey,
          'pkcs8',
        ),
    ],
    [
      'an X25519 key',
      () => write('x.key', generateKeyPairSync('x25519').privateKey, 'pkcs8'),
    ],
    [
      'a public key',
      () => write('dt.pub', generateKeyPairSync('ed25519').publicKey, 'spki'),
    ],
  ])('Should refuse %s, naming the file', (_, file) => {
    const name = file();

    expect(() => Signer.load(name, dir, 'dt-1')).toThrow(join(dir, name));
  });

  it('Should refuse an encrypted key without showing it', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const pem = privateKey.export({
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: 'secret',
    });
    writeFileSync(join(dir, 'locked.key'), pem);
    const body = String(pem).split('\n')[1];

    expect(() => Signer.load('locked.key', dir, 'dt-1')).toThrow(
      join(dir, 'locked.key'),
    );
    expect(() => Signer.load('locked.key', dir, 'dt-1')).not.toThrow(body);
  });
});
