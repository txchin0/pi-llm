import type { UserIntegrationState } from './store/integrationStore.js';
import type { IntegrationDefinition } from './types.js';

/** Merges stored enablement with the integration definition default. */
export function effectiveEnabled(
  definition: IntegrationDefinition,
  storedState: UserIntegrationState | undefined,
): boolean {
  return storedState?.enabled ?? definition.defaultEnabled;
}
