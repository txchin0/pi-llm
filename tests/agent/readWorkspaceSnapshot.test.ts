import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CONVENTIONS_MAX_CHARS,
  FILE_LISTING_MAX_ENTRIES,
  INDEX_SNAPSHOT_MAX_CHARS,
  readWorkspaceSnapshot,
} from '../../src/agent/readWorkspaceSnapshot.js';

describe('readWorkspaceSnapshot', () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), 'pi-llm-snapshot-'));
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it('returns empty strings for missing index and conventions', async () => {
    const snapshot = await readWorkspaceSnapshot(workspacePath);

    expect(snapshot.indexMarkdown).toBe('');
    expect(snapshot.conventionsMarkdown).toBe('');
    expect(snapshot.fileListing).toEqual([]);
    expect(snapshot.fieldTruncation).toEqual({
      index: false,
      conventions: false,
      fileListing: false,
    });
  });

  it('reads index and conventions when present', async () => {
    await writeFile(join(workspacePath, 'index.md'), '# Index\n- profile.md');
    await writeFile(join(workspacePath, 'conventions.md'), '# Rules\n');

    const snapshot = await readWorkspaceSnapshot(workspacePath);

    expect(snapshot.indexMarkdown).toBe('# Index\n- profile.md');
    expect(snapshot.conventionsMarkdown).toBe('# Rules\n');
    expect(snapshot.fieldTruncation).toEqual({
      index: false,
      conventions: false,
      fileListing: false,
    });
  });

  it('truncates index at a line boundary and sets fieldTruncation.index', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line-${i}:${'x'.repeat(100)}`);
    const content = lines.join('\n');
    expect(content.length).toBeGreaterThan(INDEX_SNAPSHOT_MAX_CHARS);

    await writeFile(join(workspacePath, 'index.md'), content);

    const snapshot = await readWorkspaceSnapshot(workspacePath);

    expect(snapshot.indexMarkdown.length).toBeLessThanOrEqual(INDEX_SNAPSHOT_MAX_CHARS);
    expect(snapshot.indexMarkdown).not.toContain(lines.at(-1));
    expect(snapshot.fieldTruncation.index).toBe(true);
  });

  it('truncates conventions at a line boundary', async () => {
    const line = 'y'.repeat(100);
    const lines = Array.from({ length: 40 }, () => line);
    const content = lines.join('\n');
    expect(content.length).toBeGreaterThan(CONVENTIONS_MAX_CHARS);

    await writeFile(join(workspacePath, 'conventions.md'), content);

    const snapshot = await readWorkspaceSnapshot(workspacePath);

    expect(snapshot.conventionsMarkdown.length).toBeLessThanOrEqual(CONVENTIONS_MAX_CHARS);
    expect(snapshot.fieldTruncation.conventions).toBe(true);
  });

  it('lists files with relative forward-slash paths, sorted and capped', async () => {
    await mkdir(join(workspacePath, 'notes'));
    await writeFile(join(workspacePath, 'index.md'), '');
    await writeFile(join(workspacePath, 'profile.md'), '');
    await writeFile(join(workspacePath, 'notes', 'topic.md'), '');

    const snapshot = await readWorkspaceSnapshot(workspacePath);

    expect(snapshot.fileListing).toEqual(['index.md', 'notes/topic.md', 'profile.md']);
  });

  it('caps file listing at FILE_LISTING_MAX_ENTRIES', async () => {
    for (let i = 0; i < FILE_LISTING_MAX_ENTRIES + 5; i += 1) {
      await writeFile(join(workspacePath, `file-${String(i).padStart(4, '0')}.md`), '');
    }

    const snapshot = await readWorkspaceSnapshot(workspacePath);

    expect(snapshot.fileListing).toHaveLength(FILE_LISTING_MAX_ENTRIES);
    expect(snapshot.fieldTruncation.fileListing).toBe(true);
    expect(snapshot.fileListing[0]).toBe('file-0000.md');
    expect(snapshot.fileListing.at(-1)).toBe(
      `file-${String(FILE_LISTING_MAX_ENTRIES - 1).padStart(4, '0')}.md`,
    );
  });
});
