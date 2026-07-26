import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

export type WorkspaceSnapshot = {
  /** Contents of index.md, capped; '' when missing. Trimmed by prompt formatters. */
  indexMarkdown: string;
  /** Contents of conventions.md, capped; '' when missing. Trimmed by prompt formatters. */
  conventionsMarkdown: string;
  /** Sorted relative file paths (forward slashes), capped. */
  fileListing: string[];
  /** Per-field truncation flags for prompt substitution markers. */
  fieldTruncation: {
    index: boolean;
    conventions: boolean;
    fileListing: boolean;
  };
};

/** Inputs gathered by the session harness for role system-prompt builders. */
export type SystemPromptInputs = {
  promptFragments: string[];
  /** One sentence per enabled integration declaring `workerCapability`; the worker ignores these. */
  workerCapabilities: string[];
  workspace: WorkspaceSnapshot;
};

export const INDEX_SNAPSHOT_MAX_CHARS = 4_000;
export const CONVENTIONS_MAX_CHARS = 3_000;
export const FILE_LISTING_MAX_ENTRIES = 200;

const INDEX_FILE = 'index.md';
const CONVENTIONS_FILE = 'conventions.md';

/** Truncates text to maxChars at the last complete line boundary within the cap. */
function truncateAtLineBoundary(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  const slice = text.slice(0, maxChars);
  const lastNewline = slice.lastIndexOf('\n');
  const truncatedText = lastNewline >= 0 ? slice.slice(0, lastNewline) : '';

  return { text: truncatedText, truncated: true };
}

/** Reads a workspace file; returns '' on ENOENT and rethrows other errors. */
async function readWorkspaceFile(workspacePath: string, fileName: string): Promise<string> {
  try {
    return await readFile(join(workspacePath, fileName), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

/** Collects sorted relative file paths under workspacePath (forward slashes). */
async function listWorkspaceFiles(workspacePath: string): Promise<string[]> {
  const entries = await readdir(workspacePath, { recursive: true, withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const absolutePath = join(entry.parentPath, entry.name);
    const relativePath = relative(workspacePath, absolutePath).replaceAll('\\', '/');
    paths.push(relativePath);
  }

  return paths.sort((a, b) => a.localeCompare(b));
}

/** Reads index, conventions, and file listing from a user memory workspace. */
export async function readWorkspaceSnapshot(workspacePath: string): Promise<WorkspaceSnapshot> {
  const [indexRaw, conventionsRaw, allFiles] = await Promise.all([
    readWorkspaceFile(workspacePath, INDEX_FILE),
    readWorkspaceFile(workspacePath, CONVENTIONS_FILE),
    listWorkspaceFiles(workspacePath),
  ]);

  const indexResult = truncateAtLineBoundary(indexRaw, INDEX_SNAPSHOT_MAX_CHARS);
  const conventionsResult = truncateAtLineBoundary(conventionsRaw, CONVENTIONS_MAX_CHARS);

  const listingTruncated = allFiles.length > FILE_LISTING_MAX_ENTRIES;
  const fileListing = listingTruncated
    ? allFiles.slice(0, FILE_LISTING_MAX_ENTRIES)
    : allFiles;

  return {
    indexMarkdown: indexResult.text,
    conventionsMarkdown: conventionsResult.text,
    fileListing,
    fieldTruncation: {
      index: indexResult.truncated,
      conventions: conventionsResult.truncated,
      fileListing: listingTruncated,
    },
  };
}
