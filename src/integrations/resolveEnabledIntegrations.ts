import type { AppLogger } from '../logging/types.js';
import { effectiveEnabled } from './integrationState.js';
import { parseIntegrationConfig } from './parseIntegrationConfig.js';
import { listIntegrations } from './registry.js';
import type { IntegrationStore } from './store/integrationStore.js';
import type { EnabledIntegration } from './types.js';

export type ResolveEnabledIntegrationsOptions = {
  log?: AppLogger;
};

/** Resolves enabled integrations for a user by merging store state with definition defaults. */
export async function resolveEnabledIntegrations(
  store: IntegrationStore,
  userId: string,
  options: ResolveEnabledIntegrationsOptions = {},
): Promise<EnabledIntegration[]> {
  const stored = await store.list(userId);
  const enabled: EnabledIntegration[] = [];

  for (const definition of listIntegrations()) {
    const storedState = stored[definition.id];
    if (!effectiveEnabled(definition, storedState)) {
      continue;
    }

    const rawConfig = storedState?.config ?? {};
    const config = parseIntegrationConfig(definition, rawConfig, options.log);
    enabled.push({ definition, config });
  }

  return enabled;
}
