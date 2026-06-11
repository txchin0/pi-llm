import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Returns the absolute path to the Drizzle migrations directory. */
export function resolveMigrationsFolder(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
}
