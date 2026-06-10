import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { isPathInsideWorkspace } from '../../src/surface/util/isPathInsideWorkspace.js';

const tempDirs: string[] = [];

afterEach(async () => {
  tempDirs.length = 0;
});

describe('isPathInsideWorkspace', () => {
  it('allows paths inside the workspace', async () => {
    const workspace = await makeTempDir();
    const nested = join(workspace, 'people', 'alice.md');
    await mkdir(join(workspace, 'people'), { recursive: true });
    await writeFile(nested, '# Alice\n');

    expect(isPathInsideWorkspace('people/alice.md', workspace)).toBe(true);
    expect(isPathInsideWorkspace(nested, workspace)).toBe(true);
  });

  it('blocks parent traversal', async () => {
    const workspace = await makeTempDir();
    expect(isPathInsideWorkspace('../outside.txt', workspace)).toBe(false);
  });

  it('blocks absolute paths outside the workspace', async () => {
    const workspace = await makeTempDir();
    const outside = await makeTempDir();
    const outsideFile = join(outside, 'secret.txt');
    await writeFile(outsideFile, 'secret');

    expect(isPathInsideWorkspace(outsideFile, workspace)).toBe(false);
  });

  it('blocks symlink escape', async () => {
    const workspace = await makeTempDir();
    const outside = await makeTempDir();
    const outsideFile = join(outside, 'secret.txt');
    await writeFile(outsideFile, 'secret');

    const linkPath = join(workspace, 'escape-link');
    try {
      await symlink(outsideFile, linkPath, 'file');
      expect(isPathInsideWorkspace(linkPath, workspace)).toBe(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('privilege') && !message.includes('EPERM')) {
        throw error;
      }
    }
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pi-llm-workspace-'));
  tempDirs.push(dir);
  return dir;
}
