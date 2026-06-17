/** Persisted OAuth callback state bound to one user and PKCE verifier. */
export type OAuthStateEntry = {
  userId: string;
  providerId: string;
  codeVerifier: string;
  createdAtMs: number;
};

/** Input for storing a new OAuth callback state entry. */
export type CreateOAuthStateInput = {
  state: string;
  userId: string;
  providerId: string;
  codeVerifier: string;
};

/** Error codes when consuming an OAuth callback state. */
export type OAuthStateErrorCode = 'unknown' | 'expired';

/** Thrown when callback state is missing or no longer valid. */
export class OAuthStateError extends Error {
  readonly code: OAuthStateErrorCode;

  /** Creates an error for unknown or expired OAuth callback state. */
  constructor(code: OAuthStateErrorCode) {
    super(code === 'unknown' ? 'Unknown OAuth state' : 'Expired OAuth state');
    this.name = 'OAuthStateError';
    this.code = code;
  }
}

export type OAuthStateStoreOptions = {
  /** Maximum age of a state entry before it is rejected. Defaults to 10 minutes. */
  ttlMs?: number;
};

export type OAuthStateStore = {
  /** Stores a new callback state entry (single-process MVP only). */
  create(input: CreateOAuthStateInput): void;
  /** Returns and deletes a valid state entry, rejecting unknown or expired state. */
  consume(state: string): OAuthStateEntry;
};

const DEFAULT_TTL_MS = 10 * 60 * 1000;

/**
 * In-memory OAuth callback state store with TTL expiry.
 *
 * Single-process MVP only: state is lost on restart and is not shared across instances.
 */
export function createInMemoryOAuthStateStore(
  options: OAuthStateStoreOptions = {},
): OAuthStateStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const entries = new Map<string, OAuthStateEntry>();

  return {
    create({ state, userId, providerId, codeVerifier }) {
      sweepExpiredEntries(entries, ttlMs);
      entries.set(state, {
        userId,
        providerId,
        codeVerifier,
        createdAtMs: Date.now(),
      });
    },

    consume(state) {
      const entry = entries.get(state);
      if (entry === undefined) {
        throw new OAuthStateError('unknown');
      }

      entries.delete(state);
      if (isExpired(entry.createdAtMs, ttlMs)) {
        throw new OAuthStateError('expired');
      }

      return entry;
    },
  };
}

/** Removes expired entries from the in-memory state map. */
function sweepExpiredEntries(
  entries: Map<string, OAuthStateEntry>,
  ttlMs: number,
): void {
  const now = Date.now();
  for (const [state, entry] of entries) {
    if (now - entry.createdAtMs > ttlMs) {
      entries.delete(state);
    }
  }
}

/** Returns whether a state entry has exceeded the configured TTL. */
function isExpired(createdAtMs: number, ttlMs: number): boolean {
  return Date.now() - createdAtMs > ttlMs;
}
