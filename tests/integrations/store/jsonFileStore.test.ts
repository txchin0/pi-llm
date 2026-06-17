import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readJsonFile, writeJsonFileAtomic } from '../../../src/integrations/store/jsonFileStore.js';

const tempDirs: string[] = [];

async function createTempPath(filename: string) {
  const dataRoot = await mkdtemp(join(tmpdir(), 'pi-llm-json-store-'));
  tempDirs.push(dataRoot);
  return join(dataRoot, filename);
}

describe('jsonFileStore', () => {
  afterEach(() => {
    tempDirs.length = 0;
  });

  it('returns fallback when the file is missing', async () => {
    const path = await createTempPath('missing.json');
    await expect(readJsonFile(path, { default: true })).resolves.toEqual({ default: true });
  });

  it('round-trips write then read', async () => {
    const path = await createTempPath('data.json');
    const payload = { alpha: { enabled: true }, beta: { enabled: false } };

    await writeJsonFileAtomic(path, payload);
    await expect(readJsonFile(path, {})).resolves.toEqual(payload);

    const raw = await readFile(path, 'utf8');
    expect(JSON.parse(raw)).toEqual(payload);
  });

  it('applies optional file mode on write', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const path = await createTempPath('secure.json');
    await writeJsonFileAtomic(path, { secret: true }, { mode: 0o600 });

    const fileStat = await stat(path);
    expect(fileStat.mode & 0o777).toBe(0o600);
  });
});
