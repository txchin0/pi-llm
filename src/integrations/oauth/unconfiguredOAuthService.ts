import {
  OAuthNotConnectedError,
  type OAuthService,
  type OAuthStartResult,
  type OAuthStatus,
} from './oauthService.js';

/**
 * OAuth adapter for deployments without an OAuth provider configured.
 *
 * Selected once at bootstrap; every other module requires an OAuthService
 * so a missing wire is a compile error rather than a silent degrade.
 */
export const unconfiguredOAuthService: OAuthService = {
  /** Reports the provider as not configured. */
  start(_userId, providerId): Promise<OAuthStartResult> {
    return Promise.resolve({
      ok: false,
      code: 'provider_not_configured',
      providerId,
    });
  },

  /** No-ops; unconfigured OAuth has no callback to complete. */
  handleCallback(): Promise<{ userId: string }> {
    return Promise.resolve({ userId: '' });
  },

  /** Always throws because no OAuth provider is connected. */
  getAccessToken(userId, providerId): Promise<string> {
    return Promise.reject(
      new OAuthNotConnectedError({
        providerId,
        userId,
        reason: 'not_connected',
      }),
    );
  },

  /** Reports disconnected state with no granted or missing scopes. */
  getStatus(): Promise<OAuthStatus> {
    return Promise.resolve({
      connected: false,
      grantedScopes: [],
      missingScopes: [],
    });
  },

  /** No-ops; there are no stored tokens to delete. */
  disconnect(): Promise<void> {
    return Promise.resolve();
  },
};
