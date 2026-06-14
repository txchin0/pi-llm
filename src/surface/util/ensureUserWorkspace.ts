import { access, cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
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

/** Returns true when a concurrent copy error means another caller won the race. */
function isCopyRaceError(code: string | undefined): boolean {
  return (
    code === 'EEXIST' ||
    code === 'ENOTEMPTY' ||
    code === 'EBUSY' ||
    code === 'EPERM' ||
    code === 'ENOENT'
  );
}

/** Copies template files into the workspace, skipping files that already exist. */
async function seedFromTemplate(
  workspacePath: string,
  templateDir: string,
): Promise<void> {
  const entries = await readdir(templateDir, {
    recursive: true,
    withFileTypes: true,
  });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const sourcePath = join(entry.parentPath, entry.name);
    const relativePath = relative(templateDir, sourcePath);
    const destPath = join(workspacePath, relativePath);

    if (await pathExists(destPath)) {
      continue;
    }

    await mkdir(dirname(destPath), { recursive: true });

    try {
      await cp(sourcePath, destPath, { errorOnExist: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (isCopyRaceError(code) && (await pathExists(destPath))) {
        continue;
      }

      throw error;
    }
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

  await seedFromTemplate(workspacePath, templateDir);
}
