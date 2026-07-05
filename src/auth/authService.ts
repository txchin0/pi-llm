import { createHash, randomBytes } from 'node:crypto';

import { signAccessToken, verifyAccessToken } from './accessToken.js';
import type { AuthStore } from './authStore.js';
import type { PasswordHasher } from './passwordHasher.js';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * A just-rotated refresh token stays usable this long. Two clients share one
 * token pair on Android (WebView + native assistant); when both refresh at
 * once the loser replays the old token and must not be logged out.
 */
const ROTATION_GRACE_MS = 60 * 1000;

export type AuthErrorCode =
  | 'user_exists'
  | 'invalid_credentials'
  | 'invalid_refresh_token';

/** Thrown for expected auth failures; the controller maps codes to HTTP. */
export class AuthError extends Error {
  readonly code: AuthErrorCode;

  /** Creates an auth failure with a stable machine-readable code. */
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/** Access + refresh token pair issued to a client. */
export type AuthTokens = {
  userId: string;
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  refreshToken: string;
};

export type AuthService = {
  register(userId: string, password: string): Promise<AuthTokens>;
  login(userId: string, password: string): Promise<AuthTokens>;
  refresh(refreshToken: string): Promise<AuthTokens>;
  /** Revokes the presented refresh token. Idempotent. */
  logout(refreshToken: string): Promise<void>;
  /** Validates an access JWT, returning the authenticated user id. */
  verifyAccess(accessToken: string): { userId: string } | undefined;
};

export type CreateAuthServiceOptions = {
  store: AuthStore;
  hasher: PasswordHasher;
  jwtSecret: string;
  now?: () => Date;
  accessTtlSeconds?: number;
  refreshTtlMs?: number;
  rotationGraceMs?: number;
};

/** Hashes a raw refresh token for storage/lookup. */
function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Creates the account + token lifecycle service. */
export function createAuthService(options: CreateAuthServiceOptions): AuthService {
  const {
    store,
    hasher,
    jwtSecret,
    now = () => new Date(),
    accessTtlSeconds = ACCESS_TTL_SECONDS,
    refreshTtlMs = REFRESH_TTL_MS,
    rotationGraceMs = ROTATION_GRACE_MS,
  } = options;

  // A single dummy hash, computed at most once, that unknown-user logins verify
  // against. Reusing one hash (rather than hashing a placeholder per attempt)
  // keeps the unknown and known paths to exactly one scrypt verify, so response
  // timing does not reveal whether an account exists.
  let dummyHashPromise: Promise<string> | undefined;
  function getDummyHash(): Promise<string> {
    dummyHashPromise ??= hasher.hash('invalid-user-placeholder');
    return dummyHashPromise;
  }

  /** Mints a fresh access + refresh pair and persists the refresh hash. */
  async function issueTokens(userId: string): Promise<AuthTokens> {
    const issuedAt = now();
    const accessToken = signAccessToken({
      userId,
      secret: jwtSecret,
      ttlSeconds: accessTtlSeconds,
      nowSeconds: Math.floor(issuedAt.getTime() / 1000),
    });

    const refreshToken = `rt_${randomBytes(32).toString('base64url')}`;
    await store.insertRefreshToken({
      id: `rtk_${randomBytes(8).toString('hex')}`,
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      createdAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + refreshTtlMs).toISOString(),
    });

    return { userId, accessToken, expiresIn: accessTtlSeconds, refreshToken };
  }

  return {
    async register(userId, password) {
      const created = await store.createUser({
        userId,
        passwordHash: await hasher.hash(password),
        createdAt: now().toISOString(),
      });

      if (!created) {
        throw new AuthError('user_exists', `User id "${userId}" is already taken.`);
      }

      return issueTokens(userId);
    },

    async login(userId, password) {
      const user = await store.getUser(userId);
      // Verify against the real hash, or the shared dummy hash for unknown
      // users, so both paths run exactly one scrypt verify (see getDummyHash).
      const passwordHash = user?.passwordHash ?? (await getDummyHash());
      const valid = await hasher.verify(password, passwordHash);

      if (user === undefined || !valid) {
        throw new AuthError('invalid_credentials', 'Incorrect user id or password.');
      }

      return issueTokens(user.userId);
    },

    async refresh(refreshToken) {
      const record = await store.getRefreshTokenByHash(hashRefreshToken(refreshToken));
      const at = now();

      if (
        record === undefined ||
        record.revokedAt !== null ||
        at.getTime() >= Date.parse(record.expiresAt)
      ) {
        throw new AuthError('invalid_refresh_token', 'Refresh token is not valid.');
      }

      if (record.rotatedAt !== null) {
        // Already used. Within the grace window this is the two-client race;
        // beyond it, treat as replay and reject. Note the in-grace path mints a
        // fresh pair on every replay (no per-token cap) — an accepted tradeoff,
        // see DESIGN.md §14.1.
        if (at.getTime() - Date.parse(record.rotatedAt) > rotationGraceMs) {
          throw new AuthError('invalid_refresh_token', 'Refresh token is not valid.');
        }
      } else {
        await store.markRefreshTokenRotated(record.id, at.toISOString());
      }

      return issueTokens(record.userId);
    },

    async logout(refreshToken) {
      const record = await store.getRefreshTokenByHash(hashRefreshToken(refreshToken));
      if (record !== undefined && record.revokedAt === null) {
        await store.revokeRefreshToken(record.id, now().toISOString());
      }
    },

    verifyAccess(accessToken) {
      return verifyAccessToken({
        token: accessToken,
        secret: jwtSecret,
        nowSeconds: Math.floor(now().getTime() / 1000),
      });
    },
  };
}
