// randomBytes and SHA-256 for the server's OAuth (PKCE) and file-name code, on Web Crypto and @noble/hashes.
import { sha256 } from '@noble/hashes/sha2.js';

function encode(bytes: Uint8Array, encoding?: string) {
  if (encoding === 'hex') return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const base64 = btoa(String.fromCharCode(...bytes));
  if (encoding === 'base64url') return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return base64;
}

class Bytes {
  constructor(readonly bytes: Uint8Array) {}
  toString(encoding?: string) {
    return encode(this.bytes, encoding);
  }
}

export function randomBytes(size: number) {
  return new Bytes(crypto.getRandomValues(new Uint8Array(size)));
}

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error(`crypto shim: ${algorithm} is not supported`);
  let data = new Uint8Array();
  const hash = {
    update(chunk: string | Uint8Array) {
      const next = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
      const joined = new Uint8Array(data.length + next.length);
      joined.set(data);
      joined.set(next, data.length);
      data = joined;
      return hash;
    },
    digest(encoding?: string) {
      return encode(sha256(data), encoding);
    },
  };
  return hash;
}

export const randomUUID = () => crypto.randomUUID();

export default { randomBytes, createHash, randomUUID };
