import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Returns true when `filePath` resolves inside `workspaceRoot` (symlink-safe). */
export function isPathInsideWorkspace(
  filePath: string,
  workspaceRoot: string,
): boolean {
  const resolvedRoot = canonicalize(realpathSync(resolve(workspaceRoot)));
  const absolutePath = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(workspaceRoot, filePath);

  let canonicalPath: string;
  try {
    canonicalPath = canonicalize(realpathSync(absolutePath));
  } catch {
    canonicalPath = canonicalize(absolutePath);
  }

  const relativePath = relative(resolvedRoot, canonicalPath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== '..' &&
      !isAbsolute(relativePath))
  );
}

/** Normalizes a path for stable prefix checks on Windows. */
function canonicalize(filePath: string): string {
  return resolve(filePath);
}
