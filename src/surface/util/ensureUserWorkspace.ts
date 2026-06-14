import { access, cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_TEMPLATE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../templates/user-memory',
);

const INDEX_FILE = 'index.md';

/** Returns true when `path` is accessible. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/** Throws when the template directory or its index file is missing. */
async function assertTemplateReady(templateDir: string): Promise<void> {
  if (!(await pathExists(templateDir))) {
    throw new Error(
      `User memory template directory not found: ${templateDir}`,
    );
  }

  const templateIndexPath = join(templateDir, INDEX_FILE);
  if (!(await pathExists(templateIndexPath))) {
    throw new Error(
      `User memory template index not found: ${templateIndexPath}`,
    );
  }
}

/**
 * Seeds the user memory workspace from the repo template when uninitialized.
 *
 * A workspace is initialized when `index.md` exists at its root. Concurrent
 * first-session calls for the same user may race; the sentinel is re-checked
 * after creating the workspace directory.
 */
export async function ensureUserWorkspace(
  workspacePath: string,
  templateDir: string = DEFAULT_TEMPLATE_DIR,
): Promise<void> {
  const indexPath = join(workspacePath, INDEX_FILE);
  if (await pathExists(indexPath)) {
    return;
  }

  await assertTemplateReady(templateDir);
  await mkdir(workspacePath, { recursive: true });

  if (await pathExists(indexPath)) {
    return;
  }

  try {
    await cp(templateDir, workspacePath, {
      recursive: true,
      errorOnExist: true,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ENOTEMPTY') {
      if (await pathExists(indexPath)) {
        return;
      }
    }

    throw error;
  }
}
