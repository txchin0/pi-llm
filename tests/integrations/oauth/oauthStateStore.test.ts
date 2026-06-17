import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createInMemoryOAuthStateStore,
  OAuthStateError,
} from '../../../src/integrations/oauth/oauthStateStore.js';

describe('createInMemoryOAuthStateStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates and consumes a state entry on the happy path', () => {
    const store = createInMemoryOAuthStateStore({ ttlMs: 60_000 });

    store.create({
      state: 'state-1',
      userId: 'user-a',
      providerId: 'google',
      codeVerifier: 'verifier-1',
    });

    expect(store.consume('state-1')).toEqual({
      userId: 'user-a',
      providerId: 'google',
      codeVerifier: 'verifier-1',
      createdAtMs: Date.now(),
    });
  });

  it('rejects unknown state on consume', () => {
    const store = createInMemoryOAuthStateStore();

    expect(() => store.consume('missing')).toThrow(OAuthStateError);
    expect(() => store.consume('missing')).toThrowError(
      expect.objectContaining({ code: 'unknown' }),
    );
  });

  it('rejects expired state on consume', () => {
    const store = createInMemoryOAuthStateStore({ ttlMs: 1_000 });

    store.create({
      state: 'state-expired',
      userId: 'user-a',
      providerId: 'google',
      codeVerifier: 'verifier-1',
    });

    vi.advanceTimersByTime(1_001);

    try {
      store.consume('state-expired');
      expect.fail('expected expired state to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthStateError);
      expect(error).toMatchObject({ code: 'expired' });
    }
  });

  it('is single-use and cannot be consumed twice', () => {
    const store = createInMemoryOAuthStateStore();

    store.create({
      state: 'state-once',
      userId: 'user-a',
      providerId: 'google',
      codeVerifier: 'verifier-1',
    });

    store.consume('state-once');
    expect(() => store.consume('state-once')).toThrowError(
      expect.objectContaining({ code: 'unknown' }),
    );
  });
});
