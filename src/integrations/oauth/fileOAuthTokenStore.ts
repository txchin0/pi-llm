import { readJsonFile, writeJsonFileAtomic } from '../store/jsonFileStore.js';
import type { OAuthTokenStore, StoredOAuthToken } from './oauthTokenStore.js';
import { resolveUserOAuthPath } from './resolveUserOAuthPath.js';

export type FileOAuthTokenStoreOptions = {
  dataRoot: string;
};

const OAUTH_FILE_MODE = 0o600;

/** Reads and writes per-user OAuth tokens as JSON under the data root. */
export function createFileOAuthTokenStore(
  options: FileOAuthTokenStoreOptions,
): OAuthTokenStore {
  return {
    async get(userId, providerId) {
      const all = await readOAuthFile(resolveUserOAuthPath(options.dataRoot, userId));
      return all[providerId] ?? null;
    },

    async set(userId, providerId, token) {
      const path = resolveUserOAuthPath(options.dataRoot, userId);
      const all = await readOAuthFile(path);
      all[providerId] = token;
      await writeOAuthFile(path, all);
    },

    async delete(userId, providerId) {
      const path = resolveUserOAuthPath(options.dataRoot, userId);
      const all = await readOAuthFile(path);
      if (!(providerId in all)) {
        return;
      }
      delete all[providerId];
      await writeOAuthFile(path, all);
    },
  };
}

/** Loads oauth.json, returning `{}` when the file is missing or invalid. */
async function readOAuthFile(path: string): Promise<Record<string, StoredOAuthToken>> {
  return readJsonFile<Record<string, StoredOAuthToken>>(path, {});
}

/** Writes oauth.json atomically with restrictive file permissions. */
async function writeOAuthFile(
  path: string,
  data: Record<string, StoredOAuthToken>,
): Promise<void> {
  await writeJsonFileAtomic(path, data, { mode: OAUTH_FILE_MODE });
}
