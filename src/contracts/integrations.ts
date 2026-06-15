import { z } from 'zod';

import { effectiveEnabled } from '../integrations/integrationState.js';
import type { UserIntegrationState } from '../integrations/store/integrationStore.js';
import type { IntegrationDefinition } from '../integrations/types.js';
import { UserIdSchema } from './respond.js';

export const ListIntegrationsQuerySchema = z
  .object({
    user_id: UserIdSchema,
  })
  .strict()
  .transform((query) => ({
    userId: query.user_id,
  }));

export type ParsedListIntegrationsQuery = z.infer<typeof ListIntegrationsQuerySchema>;

export const IntegrationSummarySchema = z
  .object({
    id: z.string(),
    label: z.string(),
    default_enabled: z.boolean(),
    enabled: z.boolean(),
  })
  .strict();

export type IntegrationSummary = z.infer<typeof IntegrationSummarySchema>;

export const ListIntegrationsResponseSchema = z
  .object({
    integrations: z.array(IntegrationSummarySchema),
  })
  .strict();

export type ListIntegrationsResponse = z.infer<typeof ListIntegrationsResponseSchema>;

export const IntegrationEnablementPatchSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export const UpdateIntegrationsRequestSchema = z
  .object({
    user_id: UserIdSchema,
    integrations: z.record(z.string(), IntegrationEnablementPatchSchema),
  })
  .strict()
  .transform((body) => ({
    userId: body.user_id,
    patches: body.integrations,
  }));

export type ParsedUpdateIntegrationsRequest = z.infer<typeof UpdateIntegrationsRequestSchema>;

/** Maps a registry definition and optional stored state to the public integration summary. */
export function toIntegrationSummary(
  definition: IntegrationDefinition,
  storedState: UserIntegrationState | undefined,
): IntegrationSummary {
  return IntegrationSummarySchema.parse({
    id: definition.id,
    label: definition.label,
    default_enabled: definition.defaultEnabled,
    enabled: effectiveEnabled(definition, storedState),
  });
}
