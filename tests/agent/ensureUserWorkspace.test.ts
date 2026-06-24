import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureUserWorkspace } from '../../src/agent/ensureUserWorkspace.js';

const EXPECTED_INDEX = `# Index
| Topic | Title | Summary | Tags | Last Updated |
| --- | --- | --- | --- | --- |
`;

/** Normalizes CRLF to LF for cross-platform file content assertions. */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

/** Creates a temp template directory with a valid index.md. */
async function createTemplateDir(root: string): Promise<string> {
  const templateDir = join(root, 'template');
  await mkdir(templateDir, { recursive: true });
  await writeFile(join(templateDir, 'index.md'), EXPECTED_INDEX, 'utf8');
  return templateDir;
}

describe('ensureUserWorkspace', () => {
  let tempRoot: string;
  let workspacePath: string;
  let templateDir: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'pi-llm-workspace-'));
    workspacePath = join(tempRoot, 'users', 'alice', 'memory');
    templateDir = await createTemplateDir(tempRoot);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('seeds a new workspace from the template', async () => {
    await ensureUserWorkspace(workspacePath, templateDir);

    const indexContent = await readFile(
      join(workspacePath, 'index.md'),
      'utf8',
    );
    expect(normalizeNewlines(indexContent)).toBe(EXPECTED_INDEX);
  });

  it('does not overwrite an initialized workspace', async () => {
    await mkdir(workspacePath, { recursive: true });
    const customIndex = '# Custom Index\n';
    await writeFile(join(workspacePath, 'index.md'), customIndex, 'utf8');

    await ensureUserWorkspace(workspacePath, templateDir);

    const indexContent = await readFile(
      join(workspacePath, 'index.md'),
      'utf8',
    );
    expect(indexContent).toBe(customIndex);
  });

  it('seeds into a pre-existing empty directory', async () => {
    await mkdir(workspacePath, { recursive: true });

    await ensureUserWorkspace(workspacePath, templateDir);

    const indexContent = await readFile(
      join(workspacePath, 'index.md'),
      'utf8',
    );
    expect(normalizeNewlines(indexContent)).toBe(EXPECTED_INDEX);
  });

  it('throws when the template directory is missing', async () => {
    const missingTemplateDir = join(tempRoot, 'missing-template');

    await expect(
      ensureUserWorkspace(workspacePath, missingTemplateDir),
    ).rejects.toThrow(/template directory not found/i);
  });

  it('throws when the template index file is missing', async () => {
    const emptyTemplateDir = join(tempRoot, 'empty-template');
    await mkdir(emptyTemplateDir, { recursive: true });

    await expect(
      ensureUserWorkspace(workspacePath, emptyTemplateDir),
    ).rejects.toThrow(/template index not found/i);
  });

  it('tolerates concurrent initialization for the same workspace', async () => {
    await Promise.all([
      ensureUserWorkspace(workspacePath, templateDir),
      ensureUserWorkspace(workspacePath, templateDir),
    ]);

    const indexContent = await readFile(
      join(workspacePath, 'index.md'),
      'utf8',
    );
    expect(normalizeNewlines(indexContent)).toBe(EXPECTED_INDEX);
    await access(workspacePath);
  });

  it('seeds from the repo template by default', async () => {
    await ensureUserWorkspace(workspacePath);

    const indexContent = await readFile(
      join(workspacePath, 'index.md'),
      'utf8',
    );
    expect(normalizeNewlines(indexContent)).toBe(EXPECTED_INDEX);
  });
});
