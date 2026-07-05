import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Registered accounts; `user_id` doubles as the login identifier. */
export const users = sqliteTable('users', {
  userId: text('user_id').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
});

/**
 * Long-lived refresh tokens, stored as SHA-256 hashes of the raw value.
 * Rows are rotated (not deleted) on use so a short reuse grace window can
 * absorb the WebView/native-assistant refresh race, and revoked on logout.
 */
export const refreshTokens = sqliteTable('refresh_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  rotatedAt: text('rotated_at'),
  revokedAt: text('revoked_at'),
}, (table) => [
  index('refresh_tokens_token_hash_idx').on(table.tokenHash),
  index('refresh_tokens_user_id_idx').on(table.userId),
]);
