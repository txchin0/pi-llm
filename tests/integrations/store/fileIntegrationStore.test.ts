import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createFileIntegrationStore } from '../../../src/integrations/store/fileIntegrationStore.js';
import { resolveUserIntegrationsPath } from '../../../src/integrations/store/resolveUserIntegrationsPath.js';

const tempDirs: string[] = [];

async function createTempStore() {
  const dataRoot = await mkdtemp(join(tmpdir(), 'pi-llm-integrations-'));
  tempDirs.push(dataRoot);
  return {
    store: createFileIntegrationStore({ dataRoot }),
    dataRoot,
  };
}

describe('createFileIntegrationStore', () => {
  afterEach(() => {
    tempDirs.length = 0;
  });

  it('returns an empty list when the integrations file is missing', async () => {
    const { store } = await createTempStore();
    await expect(store.list('user-a')).resolves.toEqual({});
    await expect(store.get('user-a', 'web_search')).resolves.toBeNull();
  });

  it('round-trips set and get', async () => {
    const { store } = await createTempStore();
    await store.set('user-a', 'web_search', { enabled: false, config: { apiKey: 'k' } });

    await expect(store.get('user-a', 'web_search')).resolves.toEqual({
      enabled: false,
      config: { apiKey: 'k' },
    });
  });

  it('merges by integration id without removing other entries', async () => {
    const { store } = await createTempStore();
    await store.set('user-a', 'web_search', { enabled: true });
    await store.set('user-a', 'calendar', { enabled: false });

    await expect(store.list('user-a')).resolves.toEqual({
      web_search: { enabled: true },
      calendar: { enabled: false },
    });
  });

  it('merges multiple ids atomically via setMany', async () => {
    const { store } = await createTempStore();
    await store.set('user-a', 'web_search', { enabled: true, config: { apiKey: 'k' } });

    await store.setMany('user-a', {
      web_search: { enabled: false, config: { apiKey: 'k' } },
      calendar: { enabled: true },
    });

    await expect(store.list('user-a')).resolves.toEqual({
      web_search: { enabled: false, config: { apiKey: 'k' } },
      calendar: { enabled: true },
    });
  });

  it('persists JSON under the user integrations path', async () => {
    const { store, dataRoot } = await createTempStore();
    await store.set('user-b', 'web_search', { enabled: true });

    const path = resolveUserIntegrationsPath(dataRoot, 'user-b');
    const raw = await readFile(path, 'utf8');
    expect(JSON.parse(raw)).toEqual({
      web_search: { enabled: true },
    });
  });
});
