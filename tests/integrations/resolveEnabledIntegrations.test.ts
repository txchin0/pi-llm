import { describe, expect, it } from 'vitest';

import { resolveEnabledIntegrations } from '../../src/integrations/resolveEnabledIntegrations.js';
import { noopIntegrationStore } from '../../src/integrations/store/noopIntegrationStore.js';
import type { IntegrationStore } from '../../src/integrations/store/integrationStore.js';

describe('resolveEnabledIntegrations', () => {
  it('enables web_search by default under the noop store', async () => {
    const enabled = await resolveEnabledIntegrations(noopIntegrationStore, 'user-a');
    expect(enabled.map((entry) => entry.definition.id)).toEqual(['web_search']);
  });

  it('applies stored disable overrides over definition defaults', async () => {
    const store: IntegrationStore = {
      get: () => Promise.resolve(null),
      list: () => Promise.resolve({ web_search: { enabled: false } }),
      set: () => Promise.resolve(),
      setMany: () => Promise.resolve(),
    };

    const enabled = await resolveEnabledIntegrations(store, 'user-a');
    expect(enabled).toEqual([]);
  });

  it('parses stored config for enabled integrations', async () => {
    const store: IntegrationStore = {
      get: () => Promise.resolve(null),
      list: () =>
        Promise.resolve({
          web_search: { enabled: true, config: { apiKey: ' user-key ' } },
        }),
      set: () => Promise.resolve(),
      setMany: () => Promise.resolve(),
    };

    const enabled = await resolveEnabledIntegrations(store, 'user-a');
    expect(enabled[0]?.config).toEqual({ apiKey: 'user-key' });
  });

  it('ignores unknown integration ids in stored state', async () => {
    const store: IntegrationStore = {
      get: () => Promise.resolve(null),
      list: () =>
        Promise.resolve({
          unknown_integration: { enabled: true },
        }),
      set: () => Promise.resolve(),
      setMany: () => Promise.resolve(),
    };

    const enabled = await resolveEnabledIntegrations(store, 'user-a');
    expect(enabled.map((entry) => entry.definition.id)).toEqual(['web_search']);
  });
});
