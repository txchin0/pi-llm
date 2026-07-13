import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureUserWorkspace } from '../../src/agent/ensureUserWorkspace.js';

const EXPECTED_INDEX = `# Memory index

One line per file in this workspace. Format (see conventions.md):
- \`path/from/root.md\` — one-line summary (updated YYYY-MM-DD)

- \`profile.md\` — Core facts about the user; not yet filled in.
- \`conventions.md\` — The rules for this memory workspace. Do not move or delete.
`;

const EXPECTED_CONVENTIONS = `# Memory conventions

These rules govern every file in this workspace. The worker (read/write) must
follow them.

## Layout

- \`index.md\` — index of every file here; one line per file. Keep it accurate.
- \`profile.md\` — core facts about the user: identity, key people, standing
  preferences that affect daily assistance. Check here first.
- \`people/<first-name>.md\` — one file per person in the user's life.
- \`preferences/<area>.md\` — likes and dislikes grouped by area
  (e.g. \`preferences/food.md\`, \`preferences/entertainment.md\`).
- \`projects/<name>.md\` — ongoing goals, plans, and projects.
- \`notes/<topic>.md\` — anything that fits nowhere else.
- \`documents/<name>.<ext>\` — long source material (stories, articles, pasted
  text). Do not grep or fully read documents unless the task is about that
  document; rely on the index summary instead.

## Writing rules

- Write facts in third person about the user: \`- 2026-07-10: Bob is allergic
  to nuts.\` Never first person.
- One fact per bullet, prefixed with the ISO date it was recorded.
- Append new bullets; do not rewrite existing bullets except to correct them.
  When correcting, replace the bullet rather than adding a contradicting one.
- A fact lives in exactly one file. If it could fit two, put it in the more
  specific one. Cross-reference with \`[[path/to/other-file.md]]\` when useful.
- File names: lowercase kebab-case with \`.md\` extension.

## Index format

One line per file, exactly:

- \`path/from/root.md\` — one-line summary (updated YYYY-MM-DD)

Whenever you create or change a file: add its line, or update its summary (if
the meaning changed) and its date (always).
`;

const EXPECTED_PROFILE = `# Profile

Core facts about the user. The worker fills this in as facts are learned.

## Identity

(name, pronouns, location, timezone — add bullets as learned)

## Key people

(family, partner, close friends — one bullet each; give a person their own
\`people/<name>.md\` file once there are 3+ facts about them, and link it here)

## Standing preferences

(only preferences that affect daily assistance — e.g. scheduling habits,
communication style; topical likes/dislikes go in \`preferences/\`)
`;

/** Normalizes CRLF to LF for cross-platform file content assertions. */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

/** Creates a temp template directory with the three template files. */
async function createTemplateDir(root: string): Promise<string> {
  const templateDir = join(root, 'template');
  await mkdir(templateDir, { recursive: true });
  await writeFile(join(templateDir, 'index.md'), EXPECTED_INDEX, 'utf8');
  await writeFile(
    join(templateDir, 'conventions.md'),
    EXPECTED_CONVENTIONS,
    'utf8',
  );
  await writeFile(join(templateDir, 'profile.md'), EXPECTED_PROFILE, 'utf8');
  return templateDir;
}

/** Asserts all three template files were seeded with expected content. */
async function expectFullTemplateSeed(workspacePath: string): Promise<void> {
  const indexContent = await readFile(join(workspacePath, 'index.md'), 'utf8');
  const conventionsContent = await readFile(
    join(workspacePath, 'conventions.md'),
    'utf8',
  );
  const profileContent = await readFile(
    join(workspacePath, 'profile.md'),
    'utf8',
  );
  expect(normalizeNewlines(indexContent)).toBe(EXPECTED_INDEX);
  expect(normalizeNewlines(conventionsContent)).toBe(EXPECTED_CONVENTIONS);
  expect(normalizeNewlines(profileContent)).toBe(EXPECTED_PROFILE);
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
    await expectFullTemplateSeed(workspacePath);
  });

  it('does not overwrite existing workspace files', async () => {
    await mkdir(workspacePath, { recursive: true });
    const customIndex = '# Custom Index\n';
    const customConventions = '# Custom conventions\n';
    const customProfile = '# Custom profile\n';
    await writeFile(join(workspacePath, 'index.md'), customIndex, 'utf8');
    await writeFile(
      join(workspacePath, 'conventions.md'),
      customConventions,
      'utf8',
    );
    await writeFile(join(workspacePath, 'profile.md'), customProfile, 'utf8');

    await ensureUserWorkspace(workspacePath, templateDir);

    expect(await readFile(join(workspacePath, 'index.md'), 'utf8')).toBe(
      customIndex,
    );
    expect(await readFile(join(workspacePath, 'conventions.md'), 'utf8')).toBe(
      customConventions,
    );
    expect(await readFile(join(workspacePath, 'profile.md'), 'utf8')).toBe(
      customProfile,
    );
  });

  it('re-seeds missing template files when index.md already exists', async () => {
    await mkdir(workspacePath, { recursive: true });
    const customIndex = '# Custom Index\n';
    await writeFile(join(workspacePath, 'index.md'), customIndex, 'utf8');

    await ensureUserWorkspace(workspacePath, templateDir);

    const indexContent = await readFile(
      join(workspacePath, 'index.md'),
      'utf8',
    );
    expect(indexContent).toBe(customIndex);
    expect(
      normalizeNewlines(
        await readFile(join(workspacePath, 'conventions.md'), 'utf8'),
      ),
    ).toBe(EXPECTED_CONVENTIONS);
    expect(
      normalizeNewlines(
        await readFile(join(workspacePath, 'profile.md'), 'utf8'),
      ),
    ).toBe(EXPECTED_PROFILE);
  });

  it('seeds into a pre-existing empty directory', async () => {
    await mkdir(workspacePath, { recursive: true });

    await ensureUserWorkspace(workspacePath, templateDir);
    await expectFullTemplateSeed(workspacePath);
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

    await expectFullTemplateSeed(workspacePath);
    await access(workspacePath);
  });

  it('seeds from the repo template by default', async () => {
    await ensureUserWorkspace(workspacePath);
    await expectFullTemplateSeed(workspacePath);
  });
});
