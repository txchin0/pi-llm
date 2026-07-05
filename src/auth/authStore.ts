/** A registered account row. */
export type UserRecord = {
  userId: string;
  passwordHash: string;
  createdAt: string;
};

/** A persisted (hashed) refresh token row. */
export type RefreshTokenRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
};

export type InsertRefreshTokenInput = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
};

/** Persistence boundary for accounts and refresh tokens. */
export type AuthStore = {
  /** Inserts a user; returns false when the user id is already taken. */
  createUser(user: UserRecord): Promise<boolean>;
  getUser(userId: string): Promise<UserRecord | undefined>;
  insertRefreshToken(input: InsertRefreshTokenInput): Promise<void>;
  getRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | undefined>;
  markRefreshTokenRotated(id: string, rotatedAt: string): Promise<void>;
  revokeRefreshToken(id: string, revokedAt: string): Promise<void>;
  close(): void;
};
