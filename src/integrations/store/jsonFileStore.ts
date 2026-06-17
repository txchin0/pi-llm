import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type WriteJsonFileAtomicOptions = {
  /** Optional file mode (e.g. 0o600) applied to the written file. */
  mode?: number;
};

/** Reads JSON from path, returning fallback when the file is missing or not an object. */
export async function readJsonFile<T extends Record<string, unknown>>(
  path: string,
  fallback: T,
): Promise<T> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return fallback;
    }

    return parsed as T;
  } catch (error) {
    if (isENOENT(error)) {
      return fallback;
    }
    throw error;
  }
}

/** Writes JSON atomically via temp file and rename; optionally sets file mode. */
export async function writeJsonFileAtomic<T>(
  path: string,
  data: T,
  options?: WriteJsonFileAtomicOptions,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  if (options?.mode !== undefined) {
    await chmod(tempPath, options.mode);
  }
  await rename(tempPath, path);
  if (options?.mode !== undefined) {
    await chmod(path, options.mode);
  }
}

function isENOENT(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
