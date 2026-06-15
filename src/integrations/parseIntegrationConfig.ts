import type { AppLogger } from '../logging/types.js';
import type { IntegrationDefinition } from './types.js';

/** Parses stored config via the integration's parser, falling back to `{}` on failure. */
export function parseIntegrationConfig(
  definition: IntegrationDefinition,
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
