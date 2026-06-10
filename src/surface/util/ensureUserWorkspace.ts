import { mkdir } from 'node:fs/promises';

/** Creates the user memory workspace directory when missing. */
export async function ensureUserWorkspace(workspacePath: string): Promise<void> {
  await mkdir(workspacePath, { recursive: true });
}
