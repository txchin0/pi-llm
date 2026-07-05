import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Memory-hard password hashing behind a small interface so a later move to
 * argon2id (or a managed IdP) is a swap, not a rewrite. Hashes are
 * self-describing (`scrypt:N:r:p:salt:hash`), so cost parameters can be
 * raised without invalidating stored hashes.
 */
export type PasswordHasher = {
  hash(password: string): Promise<string>;
  verify(password: string, storedHash: string): Promise<boolean>;
};

// Interactive-login cost: 16 MiB (128 * N * r), well under scrypt's default
// 32 MiB maxmem so no option juggling is needed.
const SCRYPT_N = 2 ** 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** Derives a scrypt key for the given parameters. */
async function deriveKey(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return scryptAsync(password, salt, KEY_LENGTH, { N: n, r, p });
}

/** Creates the default Node-crypto scrypt password hasher. */
export function createScryptPasswordHasher(): PasswordHasher {
  return {
    async hash(password) {
      const salt = randomBytes(SALT_LENGTH);
      const key = await deriveKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
      return [
        'scrypt',
        String(SCRYPT_N),
        String(SCRYPT_R),
        String(SCRYPT_P),
        salt.toString('base64url'),
        key.toString('base64url'),
      ].join(':');
    },

    async verify(password, storedHash) {
      const parts = storedHash.split(':');
      if (parts.length !== 6 || parts[0] !== 'scrypt') {
        return false;
      }

      const n = Number(parts[1]);
      const r = Number(parts[2]);
      const p = Number(parts[3]);
      if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
        return false;
      }

      const salt = Buffer.from(parts[4]!, 'base64url');
      const expected = Buffer.from(parts[5]!, 'base64url');
      if (expected.length !== KEY_LENGTH) {
        return false;
      }

      const actual = await deriveKey(password, salt, n, r, p);
      return timingSafeEqual(actual, expected);
    },
  };
}
