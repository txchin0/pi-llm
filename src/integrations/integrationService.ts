import {
  toIntegrationSummary,
  type ListIntegrationsResponse,
  type ParsedUpdateIntegrationsRequest,
} from '../contracts/integrations.js';
import { getIntegration, listIntegrations } from './registry.js';
import type { IntegrationStore } from './store/integrationStore.js';

export type IntegrationServiceDependencies = {
  store: IntegrationStore;
};

export type UpdateIntegrationsResult =
  | { ok: true; body: ListIntegrationsResponse }
  | { ok: false; code: 'unknown_integration'; integrationId: string };

/** Lists and updates per-user integration enablement. */
export interface IntegrationService {
  listForUser(userId: string): Promise<ListIntegrationsResponse>;
  updateForUser(request: ParsedUpdateIntegrationsRequest): Promise<UpdateIntegrationsResult>;
}

/** Creates an integration service backed by the integration store port. */
export function createIntegrationService(
  dependencies: IntegrationServiceDependencies,
): IntegrationService {
  const { store } = dependencies;

  return {
    async listForUser(userId) {
      const stored = await store.list(userId);
      return {
        integrations: listIntegrations().map((definition) =>
          toIntegrationSummary(definition, stored[definition.id]),
        ),
      };
    },

    async updateForUser(request) {
      for (const integrationId of Object.keys(request.patches)) {
        if (getIntegration(integrationId) === undefined) {
          return { ok: false, code: 'unknown_integration', integrationId };
        }
      }

      const stored = await store.list(request.userId);
      const updates: Record<string, { enabled: boolean; config?: Record<string, unknown> }> =
        {};

      for (const [integrationId, patch] of Object.entries(request.patches)) {
        const existing = stored[integrationId];
        updates[integrationId] = {
          enabled: patch.enabled,
          ...(existing?.config !== undefined ? { config: existing.config } : {}),
        };
      }

      await store.setMany(request.userId, updates);

      const refreshed = await store.list(request.userId);
      return {
        ok: true,
        body: {
          integrations: listIntegrations().map((definition) =>
            toIntegrationSummary(definition, refreshed[definition.id]),
          ),
        },
      };
    },
  };
}
