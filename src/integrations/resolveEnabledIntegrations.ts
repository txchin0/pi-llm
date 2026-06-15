import type { AppLogger } from '../logging/types.js';
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
    const isEnabled = storedState?.enabled ?? definition.defaultEnabled;
    if (!isEnabled) {
      continue;
    }

    const rawConfig = storedState?.config ?? {};
    const config = parseIntegrationConfig(definition, rawConfig, options.log);
    enabled.push({ definition, config });
  }

  return enabled;
}

/** Parses stored config via the integration's parser, falling back to `{}` on failure. */
function parseIntegrationConfig(
  definition: EnabledIntegration['definition'],
  raw: Record<string, unknown>,
  log?: AppLogger,
): unknown {
  if (definition.parseConfig === undefined) {
    return {};
  }

  try {
    return definition.parseConfig(raw);
  } catch (error) {
    log?.warn(
      {
        event: 'integrations.config.parse_failed',
        integration_id: definition.id,
        err: error,
      },
      'integration config parse failed; using defaults',
    );
    return {};
  }
}
