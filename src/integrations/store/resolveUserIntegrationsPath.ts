import { join } from 'node:path';

/** Resolves the per-user integrations JSON file under the data root. */
export function resolveUserIntegrationsPath(dataRoot: string, userId: string): string {
  return join(dataRoot, 'users', userId, 'integrations.json');
}
