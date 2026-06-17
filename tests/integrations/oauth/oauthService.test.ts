import { describe, expect, it, vi } from 'vitest';

import { createOAuthService } from '../../../src/integrations/oauth/oauthService.js';
import { OAuthStateError } from '../../../src/integrations/oauth/oauthStateStore.js';
import type {
  OAuthProviderDefinition,
  OAuthTokens,
} from '../../../src/integrations/oauth/oauthProvider.js';
import type {
  OAuthTokenStore,
  StoredOAuthToken,
} from '../../../src/integrations/oauth/oauthTokenStore.js';
import type { IntegrationStore } from '../../../src/integrations/store/integrationStore.js';

function createMemoryTokenStore(
  initial: Record<string, Record<string, StoredOAuthToken>> = {},
): OAuthTokenStore {
  const data = structuredClone(initial);

  return {
    get(userId, providerId) {
      return Promise.resolve(data[userId]?.[providerId] ?? null);
    },
    set(userId, providerId, token) {
      data[userId] ??= {};
      data[userId][providerId] = token;
      return Promise.resolve();
    },
    delete(userId, providerId) {
      if (data[userId] !== undefined) {
        delete data[userId][providerId];
      }
      return Promise.resolve();
    },
  };
}

function createStubIntegrationStore(): IntegrationStore {
  return {
    get: () => Promise.resolve(null),
    list: () => Promise.resolve({}),
    set: () => Promise.resolve(),
    setMany: () => Promise.resolve(),
  };
}

function createStubProvider(
  overrides: Partial<OAuthProviderDefinition> = {},
): OAuthProviderDefinition {
  return {
    id: 'google',
    buildAuthUrl: () => 'https://example.com/auth',
    exchangeCode: vi.fn(() =>
      Promise.resolve({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAtMs: Date.now() + 3_600_000,
        scopes: ['calendar.readonly'],
      }),
    ),
    refreshTokens: vi.fn(() =>
      Promise.resolve({
        accessToken: 'refreshed-access',
        refreshToken: 'refresh-token',
        expiresAtMs: Date.now() + 3_600_000,
        scopes: ['calendar.readonly'],
      }),
    ),
    ...overrides,
  };
}

describe('createOAuthService', () => {
  describe('getAccessToken', () => {
    it('returns a cached valid access token without refreshing', async () => {
      const refreshTokens = vi.fn(() =>
        Promise.resolve({
          accessToken: 'refreshed-access',
          refreshToken: 'refresh-token',
          expiresAtMs: Date.now() + 3_600_000,
          scopes: ['calendar.readonly'],
        }),
      );
      const provider = createStubProvider({ refreshTokens });
      const tokenStore = createMemoryTokenStore({
        'user-a': {
          google: {
            accessToken: 'cached-access',
            refreshToken: 'refresh-token',
            expiresAtMs: Date.now() + 3_600_000,
            scopes: ['calendar.readonly'],
          },
        },
      });

      const service = createOAuthService({
        tokenStore,
        integrationStore: createStubIntegrationStore(),
        getOAuthProvider: () => provider,
      });

      await expect(
        service.getAccessToken('user-a', 'google', ['calendar.readonly']),
      ).resolves.toBe('cached-access');
      expect(refreshTokens).not.toHaveBeenCalled();
    });

    it('refreshes when the access token is expired', async () => {
      const refreshTokens = vi.fn(() =>
        Promise.resolve({
          accessToken: 'refreshed-access',
          refreshToken: 'refresh-token',
          expiresAtMs: Date.now() + 3_600_000,
          scopes: ['calendar.readonly'],
        }),
      );
      const provider = createStubProvider({ refreshTokens });
      const tokenStore = createMemoryTokenStore({
        'user-a': {
          google: {
            accessToken: 'expired-access',
            refreshToken: 'refresh-token',
            expiresAtMs: Date.now() - 1,
            scopes: ['calendar.readonly'],
          },
        },
      });

      const service = createOAuthService({
        tokenStore,
        integrationStore: createStubIntegrationStore(),
        getOAuthProvider: () => provider,
      });

      await expect(
        service.getAccessToken('user-a', 'google', ['calendar.readonly']),
      ).resolves.toBe('refreshed-access');
      expect(refreshTokens).toHaveBeenCalledTimes(1);
      const stored = await tokenStore.get('user-a', 'google');
      expect(stored?.accessToken).toBe('refreshed-access');
      expect(stored?.refreshToken).toBe('refresh-token');
      expect(stored?.scopes).toEqual(['calendar.readonly']);
    });

    it('deletes tokens and throws OAuthNotConnectedError when refresh fails', async () => {
      const provider = createStubProvider({
        refreshTokens: vi.fn(() => Promise.reject(new Error('invalid_grant'))),
      });
      const tokenStore = createMemoryTokenStore({
        'user-a': {
          google: {
            accessToken: 'expired-access',
            refreshToken: 'refresh-token',
            expiresAtMs: Date.now() - 1,
            scopes: ['calendar.readonly'],
          },
        },
      });

      const service = createOAuthService({
        tokenStore,
        integrationStore: createStubIntegrationStore(),
        getOAuthProvider: () => provider,
      });

      await expect(
        service.getAccessToken('user-a', 'google', ['calendar.readonly']),
      ).rejects.toMatchObject({
        name: 'OAuthNotConnectedError',
        reason: 'refresh_failed',
        providerId: 'google',
        userId: 'user-a',
      });
      await expect(tokenStore.get('user-a', 'google')).resolves.toBeNull();
    });

    it('throws OAuthNotConnectedError for missing scopes without deleting tokens', async () => {
      const provider = createStubProvider();
      const tokenStore = createMemoryTokenStore({
        'user-a': {
          google: {
            accessToken: 'cached-access',
            refreshToken: 'refresh-token',
            expiresAtMs: Date.now() + 3_600_000,
            scopes: ['calendar.readonly'],
          },
        },
      });

      const service = createOAuthService({
        tokenStore,
        integrationStore: createStubIntegrationStore(),
        getOAuthProvider: () => provider,
      });

      await expect(
        service.getAccessToken('user-a', 'google', ['calendar.events']),
      ).rejects.toMatchObject({
        name: 'OAuthNotConnectedError',
        reason: 'missing_scopes',
        missingScopes: ['calendar.events'],
      });
      await expect(tokenStore.get('user-a', 'google')).resolves.not.toBeNull();
    });

    it('single-flights concurrent refresh calls for one user and provider', async () => {
      let resolveRefresh: ((value: OAuthTokens) => void) | undefined;
      const refreshTokens = vi.fn(
        (): Promise<OAuthTokens> =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );
      const provider = createStubProvider({ refreshTokens });
      const tokenStore = createMemoryTokenStore({
        'user-a': {
          google: {
            accessToken: 'expired-access',
            refreshToken: 'refresh-token',
            expiresAtMs: Date.now() - 1,
            scopes: ['calendar.readonly'],
          },
        },
      });

      const service = createOAuthService({
        tokenStore,
        integrationStore: createStubIntegrationStore(),
        getOAuthProvider: () => provider,
      });

      const first = service.getAccessToken('user-a', 'google', [
        'calendar.readonly',
      ]);
      const second = service.getAccessToken('user-a', 'google', [
        'calendar.readonly',
      ]);

      await vi.waitFor(() => {
        expect(refreshTokens).toHaveBeenCalledTimes(1);
      });

      resolveRefresh?.({
        accessToken: 'refreshed-access',
        refreshToken: 'refresh-token',
        expiresAtMs: Date.now() + 3_600_000,
        scopes: ['calendar.readonly'],
      });

      await expect(Promise.all([first, second])).resolves.toEqual([
        'refreshed-access',
        'refreshed-access',
      ]);
    });
  });

  describe('handleCallback', () => {
    it('rejects invalid state', async () => {
      const service = createOAuthService({
        tokenStore: createMemoryTokenStore(),
        integrationStore: createStubIntegrationStore(),
        getOAuthProvider: () => createStubProvider(),
      });

      await expect(
        service.handleCallback('google', 'auth-code', 'missing-state'),
      ).rejects.toThrow(OAuthStateError);
    });

    it('preserves the stored refresh token when re-consent omits one', async () => {
      const provider = createStubProvider({
        exchangeCode: vi.fn(() =>
          Promise.resolve({
            accessToken: 'new-access',
            expiresAtMs: Date.now() + 3_600_000,
            scopes: ['calendar.readonly', 'calendar.events'],
          }),
        ),
      });
      const tokenStore = createMemoryTokenStore({
        'user-a': {
          google: {
            accessToken: 'old-access',
            refreshToken: 'existing-refresh',
            expiresAtMs: Date.now() - 1,
            scopes: ['calendar.readonly'],
          },
        },
      });
      const stateStore = {
        create: vi.fn(),
        consume: vi.fn(() => ({
          userId: 'user-a',
          providerId: 'google',
          codeVerifier: 'verifier-1',
          createdAtMs: Date.now(),
        })),
      };

      const service = createOAuthService({
        tokenStore,
        integrationStore: createStubIntegrationStore(),
        getOAuthProvider: () => provider,
        stateStore,
      });

      await service.handleCallback('google', 'auth-code', 'state-1');

      const stored = await tokenStore.get('user-a', 'google');
      expect(stored?.accessToken).toBe('new-access');
      expect(stored?.refreshToken).toBe('existing-refresh');
      expect(stored?.scopes).toEqual(['calendar.readonly', 'calendar.events']);
    });
  });
});
