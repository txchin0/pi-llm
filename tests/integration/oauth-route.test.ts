import { describe, expect, it, vi } from 'vitest';

import { OAuthStatusResponseSchema } from '../../src/contracts/oauth.js';
import { OAuthStateError } from '../../src/integrations/oauth/oauthStateStore.js';
import type { OAuthService } from '../../src/integrations/oauth/oauthService.js';

function createStubOAuthService(overrides: Partial<OAuthService> = {}): OAuthService {
  const start = vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      authUrl: 'https://accounts.google.com/o/oauth2/auth?client_id=test',
    }),
  );
  const handleCallback = vi.fn(() => Promise.resolve({ userId: 'web-user' }));
  const getStatus = vi.fn(() =>
    Promise.resolve({
      connected: true,
      grantedScopes: ['calendar.readonly'],
      missingScopes: [],
    }),
  );
  const disconnect = vi.fn(() => Promise.resolve());

  return {
    start,
    handleCallback,
    getAccessToken: vi.fn(),
    getStatus,
    disconnect,
    ...overrides,
  };
}

describe('oauth routes', () => {
  async function createApp(oauthService: OAuthService) {
    const { buildServer } = await import('../../src/server/buildServer.js');
    return buildServer({
      oauthService,
      requestIdFactory: () => 'req_test00000001',
    });
  }

  it('GET /v1/oauth/:providerId/start redirects to the provider auth URL', async () => {
    const start = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        authUrl: 'https://accounts.google.com/o/oauth2/auth?client_id=test',
      }),
    );
    const oauthService = createStubOAuthService({ start });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/start',
      query: { user_id: 'web-user' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      'https://accounts.google.com/o/oauth2/auth?client_id=test',
    );
    expect(start).toHaveBeenCalledWith('web-user', 'google');

    await app.close();
  });

  it('GET /v1/oauth/:providerId/start returns 400 when provider is not configured', async () => {
    const oauthService = createStubOAuthService({
      start: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          code: 'provider_not_configured' as const,
          providerId: 'google',
        }),
      ),
    });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/start',
      query: { user_id: 'web-user' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'provider_not_configured',
      message: 'OAuth provider "google" is not configured.',
      provider_id: 'google',
    });

    await app.close();
  });

  it('GET /v1/oauth/:providerId/callback returns 200 on success', async () => {
    const handleCallback = vi.fn(() => Promise.resolve({ userId: 'web-user' }));
    const oauthService = createStubOAuthService({ handleCallback });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/callback',
      query: { code: 'auth-code', state: 'opaque-state' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toBe('OAuth connected. You can close this tab.');
    expect(handleCallback).toHaveBeenCalledWith(
      'google',
      'auth-code',
      'opaque-state',
    );

    await app.close();
  });

  it('GET /v1/oauth/:providerId/callback returns 400 for invalid state', async () => {
    const oauthService = createStubOAuthService({
      handleCallback: vi.fn(() => {
        throw new OAuthStateError('unknown');
      }),
    });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/callback',
      query: { code: 'auth-code', state: 'bad-state' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'invalid_callback',
    });

    await app.close();
  });

  it('GET /v1/oauth/:providerId/status returns the public status shape', async () => {
    const oauthService = createStubOAuthService({
      getStatus: vi.fn(() =>
        Promise.resolve({
          connected: false,
          grantedScopes: [],
          missingScopes: ['calendar.readonly'],
        }),
      ),
    });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/status',
      query: { user_id: 'web-user' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');

    const body = OAuthStatusResponseSchema.parse(response.json());
    expect(body).toEqual({
      connected: false,
      granted_scopes: [],
      missing_scopes: ['calendar.readonly'],
    });

    await app.close();
  });

  it('DELETE /v1/oauth/:providerId disconnects and returns 204', async () => {
    const disconnect = vi.fn(() => Promise.resolve());
    const oauthService = createStubOAuthService({ disconnect });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/oauth/google',
      query: { user_id: 'web-user' },
    });

    expect(response.statusCode).toBe(204);
    expect(disconnect).toHaveBeenCalledWith('web-user', 'google');

    await app.close();
  });

  it('returns 404 for an unknown provider id', async () => {
    const start = vi.fn();
    const oauthService = createStubOAuthService({ start });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/unknown/start',
      query: { user_id: 'web-user' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      code: 'provider_not_found',
    });
    expect(start).not.toHaveBeenCalled();

    await app.close();
  });

  it('does not register oauth routes when oauthService is omitted', async () => {
    const { buildServer } = await import('../../src/server/buildServer.js');
    const app = buildServer({
      requestIdFactory: () => 'req_test00000001',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/start',
      query: { user_id: 'web-user' },
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
