import { z } from 'zod';

import { effectiveEnabled } from '../integrations/integrationState.js';
import type { UserIntegrationState } from '../integrations/store/integrationStore.js';
import type { IntegrationDefinition } from '../integrations/types.js';

export const ListIntegrationsQuerySchema = z
  .object({
    /** Ignored: identity comes from the access token. Accepted so pre-auth clients don't 400. */
    user_id: z.string().optional(),
  })
  .strict()
  .transform(() => ({}));

export const IntegrationOAuthSummarySchema = z
  .object({
    provider_id: z.string(),
  })
  .strict();

export const IntegrationSummarySchema = z
  .object({
    id: z.string(),
    label: z.string(),
    default_enabled: z.boolean(),
    enabled: z.boolean(),
    oauth: IntegrationOAuthSummarySchema.optional(),
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
    /** Ignored: identity comes from the access token. Accepted so pre-auth clients don't 400. */
    user_id: z.string().optional(),
    integrations: z.record(z.string(), IntegrationEnablementPatchSchema),
  })
  .strict()
  .transform((body) => ({
    patches: body.integrations,
  }));

/** A validated update request with the authenticated user id attached. */
export type ParsedUpdateIntegrationsRequest = z.infer<
  typeof UpdateIntegrationsRequestSchema
> & { userId: string };

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
    ...(definition.oauth !== undefined
      ? { oauth: { provider_id: definition.oauth.providerId } }
      : {}),
  });
}
