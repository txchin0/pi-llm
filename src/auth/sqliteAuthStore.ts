import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import type { AuthStore, RefreshTokenRecord, UserRecord } from './authStore.js';
import { refreshTokens, users } from './schema.js';

export type CreateSqliteAuthStoreOptions = {
  dbPath: string;
  migrationsFolder: string;
};

/** Maps a Drizzle row to a refresh token record. */
function mapRefreshTokenRow(
  row: typeof refreshTokens.$inferSelect,
): RefreshTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    rotatedAt: row.rotatedAt,
    revokedAt: row.revokedAt,
  };
}

/**
 * Opens the SQLite auth store (same database file as the task queue), runs
 * migrations, and returns the store API. Safe to run alongside the queue's
 * own migrate call — drizzle tracks applied migrations.
 */
export async function createSqliteAuthStore(
  options: CreateSqliteAuthStoreOptions,
): Promise<AuthStore> {
  if (options.dbPath !== ':memory:') {
    await mkdir(dirname(options.dbPath), { recursive: true });
  }

  const sqlite = new Database(options.dbPath);
  const db = drizzle(sqlite);

  migrate(db, { migrationsFolder: options.migrationsFolder });

  return {
    createUser(user: UserRecord) {
      try {
        db.insert(users)
          .values({
            userId: user.userId,
            passwordHash: user.passwordHash,
            createdAt: user.createdAt,
          })
          .run();
        return Promise.resolve(true);
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return Promise.resolve(false);
        }
        throw error;
      }
    },

    getUser(userId) {
      const row = db.select().from(users).where(eq(users.userId, userId)).get();
      return Promise.resolve(
        row === undefined
          ? undefined
          : { userId: row.userId, passwordHash: row.passwordHash, createdAt: row.createdAt },
      );
    },

    insertRefreshToken(input) {
      db.insert(refreshTokens)
        .values({
          id: input.id,
          userId: input.userId,
          tokenHash: input.tokenHash,
          createdAt: input.createdAt,
          expiresAt: input.expiresAt,
        })
        .run();
      return Promise.resolve();
    },

    getRefreshTokenByHash(tokenHash) {
      const row = db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .get();
      return Promise.resolve(row === undefined ? undefined : mapRefreshTokenRow(row));
    },

    markRefreshTokenRotated(id, rotatedAt) {
      db.update(refreshTokens)
        .set({ rotatedAt })
        .where(eq(refreshTokens.id, id))
        .run();
      return Promise.resolve();
    },

    revokeRefreshToken(id, revokedAt) {
      db.update(refreshTokens)
        .set({ revokedAt })
        .where(eq(refreshTokens.id, id))
        .run();
      return Promise.resolve();
    },

    close() {
      sqlite.close();
    },
  };
}

/** Returns whether an error is a SQLite unique-constraint violation. */
function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
  );
}
