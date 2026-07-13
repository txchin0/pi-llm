import {
  OAuthNotConnectedError,
  type OAuthService,
} from '../../../src/integrations/oauth/oauthService.js';

export const FAKE_GOOGLE_ACCESS_TOKEN = 'e2e-google-access-token';

export type FakeOAuthService = OAuthService & {
  /** Overrides the connected state for one user (wins over the constructor list). */
  setConnected(userId: string, connected: boolean): void;
};

/**
 * OAuthService fake for e2e runs: reports the listed users (or everyone) as
 * connected and hands out a fixed access token, so OAuth-gated tools execute
 * against the googleapis fake without a real consent flow. Disconnected users
 * get the real `OAuthNotConnectedError`, exercising the same "please connect"
 * tool output as production.
 */
export function createFakeOAuthService(options: {
  connectedUserIds: 'all' | string[];
}): FakeOAuthService {
  const overrides = new Map<string, boolean>();

  const isConnected = (userId: string): boolean =>
    overrides.get(userId) ??
    (options.connectedUserIds === 'all' ||
      options.connectedUserIds.includes(userId));

  return {
    start(_userId, providerId) {
      return Promise.resolve({
        ok: false,
        code: 'provider_not_configured',
        providerId,
      });
    },

    handleCallback(): Promise<{ userId: string }> {
      return Promise.reject(
        new Error('OAuth callbacks are not supported by the e2e fake'),
      );
    },

    getAccessToken(userId, providerId) {
      if (!isConnected(userId)) {
        return Promise.reject(
          new OAuthNotConnectedError({
            providerId,
            userId,
            reason: 'not_connected',
          }),
        );
      }

      return Promise.resolve(FAKE_GOOGLE_ACCESS_TOKEN);
    },

    getStatus(userId) {
      return Promise.resolve({
        connected: isConnected(userId),
        grantedScopes: [],
        missingScopes: [],
      });
    },

    disconnect(userId) {
      overrides.set(userId, false);
      return Promise.resolve();
    },

    setConnected(userId, connected) {
      overrides.set(userId, connected);
    },
  };
}
