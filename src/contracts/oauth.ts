import { z } from 'zod';

import type { OAuthStatus } from '../integrations/oauth/oauthService.js';
import { UserIdSchema } from './respond.js';

export const OAuthProviderIdParamSchema = z
  .object({
    providerId: z.string().trim().min(1),
  })
  .strict()
  .transform((params) => ({
    providerId: params.providerId,
  }));

export type ParsedOAuthProviderIdParam = z.infer<typeof OAuthProviderIdParamSchema>;

export const OAuthStartQuerySchema = z
  .object({
    user_id: UserIdSchema,
  })
  .strict()
  .transform((query) => ({
    userId: query.user_id,
  }));

export type ParsedOAuthStartQuery = z.infer<typeof OAuthStartQuerySchema>;

export const OAuthCallbackQuerySchema = z
  .object({
    code: z.string().trim().min(1),
    state: z.string().trim().min(1),
  })
  .strict()
  .transform((query) => ({
    code: query.code,
    state: query.state,
  }));

export type ParsedOAuthCallbackQuery = z.infer<typeof OAuthCallbackQuerySchema>;

export const OAuthUserQuerySchema = z
  .object({
    user_id: UserIdSchema,
  })
  .strict()
  .transform((query) => ({
    userId: query.user_id,
  }));

export type ParsedOAuthUserQuery = z.infer<typeof OAuthUserQuerySchema>;

export const OAuthStatusResponseSchema = z
  .object({
    connected: z.boolean(),
    granted_scopes: z.array(z.string()),
    missing_scopes: z.array(z.string()),
  })
  .strict();

export type OAuthStatusResponse = z.infer<typeof OAuthStatusResponseSchema>;

/** Maps service OAuth status fields to the public snake_case response shape. */
export function toOAuthStatusResponse(status: OAuthStatus): OAuthStatusResponse {
  return OAuthStatusResponseSchema.parse({
    connected: status.connected,
    granted_scopes: status.grantedScopes,
    missing_scopes: status.missingScopes,
  });
}
