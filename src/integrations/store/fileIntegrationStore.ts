import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { IntegrationStore, UserIntegrationState } from './integrationStore.js';
import { resolveUserIntegrationsPath } from './resolveUserIntegrationsPath.js';

export type FileIntegrationStoreOptions = {
  dataRoot: string;
};

/** Reads and writes per-user integration state as JSON under the data root. */
export function createFileIntegrationStore(
  options: FileIntegrationStoreOptions,
): IntegrationStore {
  return {
    async get(userId, id) {
      const all = await readIntegrationsFile(resolveUserIntegrationsPath(options.dataRoot, userId));
      return all[id] ?? null;
    },

    async list(userId) {
      return readIntegrationsFile(resolveUserIntegrationsPath(options.dataRoot, userId));
    },

    async set(userId, id, state) {
      const path = resolveUserIntegrationsPath(options.dataRoot, userId);
      const all = await readIntegrationsFile(path);
      all[id] = state;
      await writeIntegrationsFile(path, all);
    },
  };
}

/** Loads integrations JSON, returning `{}` when the file is missing or invalid. */
async function readIntegrationsFile(
  path: string,
): Promise<Record<string, UserIntegrationState>> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, UserIntegrationState>;
  } catch (error) {
    if (isENOENT(error)) {
      return {};
    }
    throw error;
  }
}

/** Writes integrations JSON atomically via temp file and rename. */
async function writeIntegrationsFile(
  path: string,
  data: Record<string, UserIntegrationState>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
}

function isENOENT(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
