import { describe, expect, it } from 'vitest';

import { createIntegrationService } from '../../src/integrations/integrationService.js';
import type { IntegrationStore } from '../../src/integrations/store/integrationStore.js';

function createMockStore(
  initial: Record<string, { enabled: boolean; config?: Record<string, unknown> }> = {},
): IntegrationStore & { state: Record<string, { enabled: boolean; config?: Record<string, unknown> }> } {
  const state = { ...initial };

  return {
    state,
    get: (_userId, id) => Promise.resolve(state[id] ?? null),
    list: () => Promise.resolve({ ...state }),
    set: (_userId, id, value) => {
      state[id] = value;
      return Promise.resolve();
    },
    setMany: (_userId, updates) => {
      Object.assign(state, updates);
      return Promise.resolve();
    },
  };
}

describe('createIntegrationService', () => {
  it('lists all registered integrations with effective enabled state', async () => {
    const store = createMockStore({ web_search: { enabled: false } });
    const service = createIntegrationService({ store });

    const body = await service.listForUser('user-a');

    expect(body.integrations).toEqual([
      {
        id: 'web_search',
        label: 'Web Search',
        default_enabled: true,
        enabled: false,
      },
      {
        id: 'google_calendar',
        label: 'Google Calendar',
        default_enabled: false,
        enabled: false,
      },
    ]);
  });

  it('uses definition defaults when stored state is missing', async () => {
    const store = createMockStore();
    const service = createIntegrationService({ store });

    const body = await service.listForUser('user-a');

    expect(body.integrations[0]).toMatchObject({
      id: 'web_search',
      default_enabled: true,
      enabled: true,
    });
  });

  it('rejects unknown integration ids on update', async () => {
    const store = createMockStore();
    const service = createIntegrationService({ store });

    const result = await service.updateForUser({
      userId: 'user-a',
      patches: { calendar: { enabled: true } },
    });

    expect(result).toEqual({
      ok: false,
      code: 'unknown_integration',
      integrationId: 'calendar',
    });
  });

  it('updates enabled state while preserving existing config', async () => {
    const store = createMockStore({
      web_search: { enabled: true, config: { apiKey: 'secret' } },
    });
    const service = createIntegrationService({ store });

    const result = await service.updateForUser({
      userId: 'user-a',
      patches: { web_search: { enabled: false } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(store.state.web_search).toEqual({
      enabled: false,
      config: { apiKey: 'secret' },
    });
    expect(result.body.integrations[0]?.enabled).toBe(false);
  });
});
