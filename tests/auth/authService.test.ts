import { describe, expect, it, vi } from 'vitest';

import { createAuthService, AuthError } from '../../src/auth/authService.js';
import {
  createScryptPasswordHasher,
  type PasswordHasher,
} from '../../src/auth/passwordHasher.js';
import { createSqliteAuthStore } from '../../src/auth/sqliteAuthStore.js';
import {
  createInMemoryConnectTokenStore,
  ConnectTokenError,
} from '../../src/integrations/oauth/connectTokenStore.js';
import { resolveMigrationsFolder } from '../../src/queue/resolveMigrationsFolder.js';

async function createService(now: () => Date) {
  const store = await createSqliteAuthStore({
    dbPath: ':memory:',
    migrationsFolder: resolveMigrationsFolder(),
  });
  return createAuthService({
    store,
    hasher: createScryptPasswordHasher(),
    jwtSecret: 'unit-test-secret',
    now,
  });
}

describe('authService time-based behavior', () => {
  it('rejects expired access tokens', async () => {
    let clock = new Date('2026-07-05T00:00:00.000Z');
    const service = await createService(() => clock);

    const tokens = await service.register('alice', 'password-123');
    expect(service.verifyAccess(tokens.accessToken)).toEqual({ userId: 'alice' });

    clock = new Date('2026-07-05T00:16:00.000Z'); // past the 15 min TTL
    expect(service.verifyAccess(tokens.accessToken)).toBeUndefined();
  });

  it('rejects refresh reuse after the rotation grace window', async () => {
    let clock = new Date('2026-07-05T00:00:00.000Z');
    const service = await createService(() => clock);

    const initial = await service.register('alice', 'password-123');
    await service.refresh(initial.refreshToken); // rotates

    clock = new Date('2026-07-05T00:00:30.000Z'); // inside 60s grace
    await expect(service.refresh(initial.refreshToken)).resolves.toBeDefined();

    clock = new Date('2026-07-05T00:02:00.000Z'); // beyond grace
    await expect(service.refresh(initial.refreshToken)).rejects.toThrowError(AuthError);
  });

  it('rejects refresh tokens past their expiry', async () => {
    let clock = new Date('2026-07-05T00:00:00.000Z');
    const service = await createService(() => clock);

    const tokens = await service.register('alice', 'password-123');

    clock = new Date('2026-08-05T00:00:01.000Z'); // past the 30 day TTL
    await expect(service.refresh(tokens.refreshToken)).rejects.toThrowError(AuthError);
  });
});

describe('authService login timing', () => {
  /** A hasher that counts calls so we can assert per-attempt scrypt work. */
  function countingHasher(): { hasher: PasswordHasher; counts: { hash: number; verify: number } } {
    const counts = { hash: 0, verify: 0 };
    const hasher: PasswordHasher = {
      hash(password) {
        counts.hash += 1;
        return Promise.resolve(`h:${password}`);
      },
      verify(password, storedHash) {
        counts.verify += 1;
        return Promise.resolve(storedHash === `h:${password}`);
      },
    };
    return { hasher, counts };
  }

  it('does the same scrypt work for unknown users and wrong passwords', async () => {
    const store = await createSqliteAuthStore({
      dbPath: ':memory:',
      migrationsFolder: resolveMigrationsFolder(),
    });
    const { hasher, counts } = countingHasher();
    const service = createAuthService({ store, hasher, jwtSecret: 'unit-test-secret' });

    await service.register('alice', 'password-123');

    // First unknown login warms the shared dummy hash (one-time hash).
    await expect(service.login('nobody', 'x')).rejects.toThrowError(AuthError);

    // After warmup, an unknown user and a known user with the wrong password
    // must be indistinguishable: one verify, zero fresh hashes on each path.
    counts.hash = 0;
    counts.verify = 0;
    await expect(service.login('also-nobody', 'x')).rejects.toThrowError(AuthError);
    expect(counts).toEqual({ hash: 0, verify: 1 });

    counts.hash = 0;
    counts.verify = 0;
    await expect(service.login('alice', 'wrong-password')).rejects.toThrowError(AuthError);
    expect(counts).toEqual({ hash: 0, verify: 1 });
  });
});

describe('connectTokenStore', () => {
  it('is single-use', () => {
    const store = createInMemoryConnectTokenStore();
    const { token } = store.create('alice');

    expect(store.consume(token)).toEqual({ userId: 'alice' });
    expect(() => store.consume(token)).toThrowError(ConnectTokenError);
  });

  it('expires tokens after the TTL', () => {
    vi.useFakeTimers();
    try {
      const store = createInMemoryConnectTokenStore({ ttlMs: 60_000 });
      const { token } = store.create('alice');

      vi.advanceTimersByTime(61_000);
      expect(() => store.consume(token)).toThrowError(ConnectTokenError);
    } finally {
      vi.useRealTimers();
    }
  });
});
