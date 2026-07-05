import { z } from 'zod';

import type { OAuthStatus } from '../integrations/oauth/oauthService.js';

export const OAuthProviderIdParamSchema = z
  .object({
    providerId: z.string().trim().min(1),
  })
  .strict()
  .transform((params) => ({
    providerId: params.providerId,
  }));

export type ParsedOAuthProviderIdParam = z.infer<typeof OAuthProviderIdParamSchema>;

/**
 * `/start` is a top-level browser navigation and cannot carry an
 * Authorization header, so identity arrives as a short-lived single-use
 * connect token minted by the authenticated `POST /v1/oauth/connect-token`.
 */
export const OAuthStartQuerySchema = z
  .object({
    connect_token: z.string().trim().min(1),
  })
  .strict()
  .transform((query) => ({
    connectToken: query.connect_token,
  }));

export type ParsedOAuthStartQuery = z.infer<typeof OAuthStartQuerySchema>;

/** Error codes echoed on `/oauth/connected` failure redirects (shared with ts-llm-frontend). */
export type OAuthCallbackErrorCode =
  | 'provider_not_configured'
  | 'provider_not_found'
  | 'invalid_state'
  | 'token_exchange_failed'
  | 'access_denied'
  | 'invalid_callback';

/** Builds the frontend OAuth connected landing page path for success or failure redirects. */
export function buildOAuthConnectedRedirectUrl(
  providerId: string,
  error?: OAuthCallbackErrorCode,
): string {
  const params = new URLSearchParams({ provider: providerId });
  if (error !== undefined) {
    params.set('error', error);
  }
  return `/oauth/connected?${params.toString()}`;
}

/**
 * Google and other providers append extra query params (e.g. iss, scope); ignore them.
 * Accepts either a success callback (`code` + `state`) or a provider error (`error`).
 */
export const OAuthCallbackQuerySchema = z
  .object({
    code: z.string().trim().min(1).optional(),
    state: z.string().trim().min(1).optional(),
    error: z.string().trim().min(1).optional(),
  })
  .superRefine((query, ctx) => {
    if (query.error !== undefined) {
      return;
    }

    if (query.code !== undefined && query.state !== undefined) {
      return;
    }

    ctx.addIssue({
      code: 'custom',
      message: 'Query must include code and state, or an error.',
    });
  })
  .transform((query) => {
    if (query.error !== undefined) {
      return {
        kind: 'error' as const,
        error: query.error,
        state: query.state,
      };
    }

    return {
      kind: 'success' as const,
      code: query.code!,
      state: query.state!,
    };
  });

export type ParsedOAuthCallbackQuery = z.infer<typeof OAuthCallbackQuerySchema>;

/** Status/disconnect identity comes from the access token; `user_id` is accepted and ignored. */
export const OAuthUserQuerySchema = z
  .object({
    user_id: z.string().optional(),
  })
  .strict();

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
