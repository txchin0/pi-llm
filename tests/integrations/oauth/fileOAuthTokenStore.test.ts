import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createFileOAuthTokenStore } from '../../../src/integrations/oauth/fileOAuthTokenStore.js';
import { resolveUserOAuthPath } from '../../../src/integrations/oauth/resolveUserOAuthPath.js';
import type { StoredOAuthToken } from '../../../src/integrations/oauth/oauthTokenStore.js';

const tempDirs: string[] = [];

const sampleToken: StoredOAuthToken = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAtMs: 1_700_000_000_000,
  scopes: ['calendar.readonly'],
};

async function createTempStore() {
  const dataRoot = await mkdtemp(join(tmpdir(), 'pi-llm-oauth-'));
  tempDirs.push(dataRoot);
  return {
    store: createFileOAuthTokenStore({ dataRoot }),
    dataRoot,
  };
}

describe('createFileOAuthTokenStore', () => {
  afterEach(() => {
    tempDirs.length = 0;
  });

  it('returns null when the oauth file or provider entry is missing', async () => {
    const { store } = await createTempStore();
    await expect(store.get('user-a', 'google')).resolves.toBeNull();
  });

  it('round-trips set and get', async () => {
    const { store } = await createTempStore();
    await store.set('user-a', 'google', sampleToken);

    await expect(store.get('user-a', 'google')).resolves.toEqual(sampleToken);
  });

  it('delete removes the provider entry without affecting others', async () => {
    const { store } = await createTempStore();
    await store.set('user-a', 'google', sampleToken);
    await store.set('user-a', 'other', {
      ...sampleToken,
      accessToken: 'other-access',
    });

    await store.delete('user-a', 'google');

    await expect(store.get('user-a', 'google')).resolves.toBeNull();
    await expect(store.get('user-a', 'other')).resolves.toEqual({
      ...sampleToken,
      accessToken: 'other-access',
    });
  });

  it('persists JSON under the user oauth path', async () => {
    const { store, dataRoot } = await createTempStore();
    await store.set('user-b', 'google', sampleToken);

    const path = resolveUserOAuthPath(dataRoot, 'user-b');
    const raw = await readFile(path, 'utf8');
    expect(JSON.parse(raw)).toEqual({
      google: sampleToken,
    });
  });
});
