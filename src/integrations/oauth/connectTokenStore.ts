import { randomBytes } from 'node:crypto';

/** Error codes when consuming a connect token. */
export type ConnectTokenErrorCode = 'unknown' | 'expired';

/** Thrown when a connect token is missing, already used, or expired. */
export class ConnectTokenError extends Error {
  readonly code: ConnectTokenErrorCode;

  /** Creates an error for an unknown/used or expired connect token. */
  constructor(code: ConnectTokenErrorCode) {
    super(code === 'unknown' ? 'Unknown connect token' : 'Expired connect token');
    this.name = 'ConnectTokenError';
    this.code = code;
  }
}

export type ConnectTokenStoreOptions = {
  /** Maximum age of a token before it is rejected. Defaults to 60 seconds. */
  ttlMs?: number;
};

export type ConnectTokenStore = {
  /** Mints a single-use token bound to the authenticated user. */
  create(userId: string): { token: string; expiresInSeconds: number };
  /** Returns and deletes the bound user id, rejecting unknown/used/expired tokens. */
  consume(token: string): { userId: string };
};

const DEFAULT_TTL_MS = 60 * 1000;

type ConnectTokenEntry = {
  userId: string;
  createdAtMs: number;
};

/**
 * In-memory single-use connect tokens for the OAuth `/start` top-level
 * navigation, which cannot carry an Authorization header. Mirrors the
 * single-process semantics of `oauthStateStore`.
 */
export function createInMemoryConnectTokenStore(
  options: ConnectTokenStoreOptions = {},
): ConnectTokenStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const entries = new Map<string, ConnectTokenEntry>();

  return {
    create(userId) {
      sweepExpiredEntries(entries, ttlMs);
      const token = `oct_${randomBytes(24).toString('base64url')}`;
      entries.set(token, { userId, createdAtMs: Date.now() });
      return { token, expiresInSeconds: Math.floor(ttlMs / 1000) };
    },

    consume(token) {
      const entry = entries.get(token);
      if (entry === undefined) {
        throw new ConnectTokenError('unknown');
      }

      entries.delete(token);
      if (Date.now() - entry.createdAtMs > ttlMs) {
        throw new ConnectTokenError('expired');
      }

      return { userId: entry.userId };
    },
  };
}

/** Removes expired entries from the in-memory token map. */
function sweepExpiredEntries(
  entries: Map<string, ConnectTokenEntry>,
  ttlMs: number,
): void {
  const now = Date.now();
  for (const [token, entry] of entries) {
    if (now - entry.createdAtMs > ttlMs) {
      entries.delete(token);
    }
  }
}
