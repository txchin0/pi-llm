import type { WorkspaceSnapshot } from '../agent/readWorkspaceSnapshot.js';

export const EMPTY_INDEX_FALLBACK = '(memory is currently empty)';

export const EMPTY_CONVENTIONS_FALLBACK =
  "(conventions.md is missing — fall back to cautious reads and tell the worker, via task descriptions, to follow index.md's format)";

export const INDEX_TRUNCATED_SUFFIX = '\n…(index truncated — read index.md for the rest)';

export const CONVENTIONS_TRUNCATED_SUFFIX =
  '\n…(conventions truncated — read conventions.md for the rest)';

export const FILE_LISTING_TRUNCATED_SUFFIX = '…(more files exist — use ls)';

/** Formats index.md snapshot text with empty and truncation markers. */
export function formatIndexSection(workspace: WorkspaceSnapshot): string {
  const trimmed = workspace.indexMarkdown.trim();
  if (trimmed.length === 0) {
    return EMPTY_INDEX_FALLBACK;
  }

  let text = trimmed;
  if (workspace.fieldTruncation.index) {
    text += INDEX_TRUNCATED_SUFFIX;
  }

  return text;
}

/** Formats conventions.md snapshot text with empty and truncation markers. */
export function formatConventionsSection(workspace: WorkspaceSnapshot): string {
  const trimmed = workspace.conventionsMarkdown.trim();
  if (trimmed.length === 0) {
    return EMPTY_CONVENTIONS_FALLBACK;
  }

  let text = trimmed;
  if (workspace.fieldTruncation.conventions) {
    text += CONVENTIONS_TRUNCATED_SUFFIX;
  }

  return text;
}

/** Formats the workspace file listing with an optional truncation marker. */
export function formatFileListingSection(workspace: WorkspaceSnapshot): string {
  if (workspace.fileListing.length === 0) {
    return '(no files yet)';
  }

  let text = workspace.fileListing.join('\n');
  if (workspace.fieldTruncation.fileListing) {
    text += `\n${FILE_LISTING_TRUNCATED_SUFFIX}`;
  }

  return text;
}
