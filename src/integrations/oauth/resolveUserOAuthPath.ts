import { join } from 'node:path';

/** Resolves the per-user OAuth tokens JSON file under the data root. */
export function resolveUserOAuthPath(dataRoot: string, userId: string): string {
  return join(dataRoot, 'users', userId, 'oauth.json');
}
