import { join } from 'node:path';

/** Returns the SQLite path for the shared task queue database. */
export function resolveTaskDbPath(dataRoot: string): string {
  return join(dataRoot, 'tasks.sqlite');
}
