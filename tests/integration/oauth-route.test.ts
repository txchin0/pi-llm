import { describe, expect, it, vi } from 'vitest';

import {
  buildOAuthConnectedRedirectUrl,
  OAuthStatusResponseSchema,
} from '../../src/contracts/oauth.js';
import {
  OAuthProviderMismatchError,
  OAuthProviderNotConfiguredError,
} from '../../src/integrations/oauth/oauthService.js';
import { OAuthStateError } from '../../src/integrations/oauth/oauthStateStore.js';
import type { OAuthService } from '../../src/integrations/oauth/oauthService.js';
import { authHeaders } from '../helpers/auth.js';
import { buildTestServer } from '../helpers/buildTestServer.js';

type TestApp = Awaited<ReturnType<typeof buildTestServer>>;

/** Registers a user (if needed) and mints a single-use OAuth connect token. */
async function mintConnectToken(app: TestApp, userId = 'web-user'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/oauth/connect-token',
    headers: await authHeaders(app, userId),
  });

  if (response.statusCode !== 200) {
    throw new Error(`connect token mint failed: ${response.body}`);
  }

  return response.json<{ connect_token: string }>().connect_token;
}

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

describe('buildOAuthConnectedRedirectUrl', () => {
  it('builds a success redirect without an error param', () => {
    expect(buildOAuthConnectedRedirectUrl('google')).toBe(
      '/oauth/connected?provider=google',
    );
  });

  it('builds a failure redirect with an encoded error param', () => {
    expect(buildOAuthConnectedRedirectUrl('google', 'invalid_state')).toBe(
      '/oauth/connected?provider=google&error=invalid_state',
    );
  });
});

describe('oauth routes', () => {
  async function createApp(oauthService: OAuthService) {
    return buildTestServer({
      oauthService,
      requestIdFactory: () => 'req_test00000001',
    });
  }

  it('POST /v1/oauth/connect-token requires a bearer token', async () => {
    const app = await createApp(createStubOAuthService());

    const response = await app.inject({
      method: 'POST',
      url: '/v1/oauth/connect-token',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'unauthorized' });

    await app.close();
  });

  it('GET /v1/oauth/:providerId/start redirects using a minted connect token', async () => {
    const start = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        authUrl: 'https://accounts.google.com/o/oauth2/auth?client_id=test',
      }),
    );
    const oauthService = createStubOAuthService({ start });
    const app = await createApp(oauthService);
    const connectToken = await mintConnectToken(app, 'web-user');

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/start',
      query: { connect_token: connectToken },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      'https://accounts.google.com/o/oauth2/auth?client_id=test',
    );
    expect(start).toHaveBeenCalledWith('web-user', 'google');

    await app.close();
  });

  it('GET /v1/oauth/:providerId/start rejects a reused connect token', async () => {
    const oauthService = createStubOAuthService();
    const app = await createApp(oauthService);
    const connectToken = await mintConnectToken(app, 'web-user');

    const first = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/start',
      query: { connect_token: connectToken },
    });
    expect(first.statusCode).toBe(302);

    const second = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/start',
      query: { connect_token: connectToken },
    });
    expect(second.statusCode).toBe(401);
    expect(second.json()).toMatchObject({ code: 'invalid_connect_token' });

    await app.close();
  });

  it('GET /v1/oauth/:providerId/start rejects an unknown connect token', async () => {
    const start = vi.fn();
    const oauthService = createStubOAuthService({ start });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/start',
      query: { connect_token: 'oct_forged' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'invalid_connect_token' });
    expect(start).not.toHaveBeenCalled();

    await app.close();
  });

  it('GET /v1/oauth/:providerId/start rejects a legacy user_id query', async () => {
    const start = vi.fn();
    const oauthService = createStubOAuthService({ start });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/start',
      query: { user_id: 'web-user' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_error' });
    expect(start).not.toHaveBeenCalled();

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
      query: { connect_token: await mintConnectToken(app, 'web-user') },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'provider_not_configured',
      message: 'OAuth provider "google" is not configured.',
      provider_id: 'google',
    });

    await app.close();
  });

  it('GET /v1/oauth/:providerId/callback redirects to the connected page on success', async () => {
    const handleCallback = vi.fn(() => Promise.resolve({ userId: 'web-user' }));
    const oauthService = createStubOAuthService({ handleCallback });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/callback',
      query: { code: 'auth-code', state: 'opaque-state' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/oauth/connected?provider=google');
    expect(handleCallback).toHaveBeenCalledWith(
      'google',
      'auth-code',
      'opaque-state',
    );

    await app.close();
  });

  it('GET /v1/oauth/:providerId/callback ignores extra provider query params', async () => {
    const handleCallback = vi.fn(() => Promise.resolve({ userId: 'web-user' }));
    const oauthService = createStubOAuthService({ handleCallback });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/callback',
      query: {
        code: '4/0AdkVLPxTJaO41OPEl2sMMd_CDZO4I6x-2v08NQ1TQVymC1IXDthOpzCPVXkidmtocRk1sw',
        state: 'brrCW2GBwhnh25F_miIUYLwLFopNH85Qbq0K5HPIiDA',
        iss: 'https://accounts.google.com',
        scope:
          'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
      },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/oauth/connected?provider=google');
    expect(handleCallback).toHaveBeenCalledWith(
      'google',
      '4/0AdkVLPxTJaO41OPEl2sMMd_CDZO4I6x-2v08NQ1TQVymC1IXDthOpzCPVXkidmtocRk1sw',
      'brrCW2GBwhnh25F_miIUYLwLFopNH85Qbq0K5HPIiDA',
    );

    await app.close();
  });

  it('GET /v1/oauth/:providerId/callback redirects with invalid_state for invalid state', async () => {
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

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      '/oauth/connected?provider=google&error=invalid_state',
    );

    await app.close();
  });

  it('GET /v1/oauth/:providerId/callback redirects with access_denied without calling the service', async () => {
    const handleCallback = vi.fn();
    const oauthService = createStubOAuthService({ handleCallback });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/callback',
      query: { error: 'access_denied', state: 'opaque-state' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      '/oauth/connected?provider=google&error=access_denied',
    );
    expect(handleCallback).not.toHaveBeenCalled();

    await app.close();
  });

  it('GET /v1/oauth/:providerId/callback redirects with provider_not_found for unknown provider', async () => {
    const handleCallback = vi.fn();
    const oauthService = createStubOAuthService({ handleCallback });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/unknown/callback',
      query: { code: 'auth-code', state: 'opaque-state' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      '/oauth/connected?provider=unknown&error=provider_not_found',
    );
    expect(handleCallback).not.toHaveBeenCalled();

    await app.close();
  });

  it('GET /v1/oauth/:providerId/callback redirects with token_exchange_failed on exchange failure', async () => {
    const oauthService = createStubOAuthService({
      handleCallback: vi.fn(() => {
        throw new Error('token exchange failed');
      }),
    });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/callback',
      query: { code: 'auth-code', state: 'opaque-state' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      '/oauth/connected?provider=google&error=token_exchange_failed',
    );

    await app.close();
  });

  it('GET /v1/oauth/:providerId/callback redirects with invalid_callback for malformed query', async () => {
    const handleCallback = vi.fn();
    const oauthService = createStubOAuthService({ handleCallback });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/callback',
      query: { code: 'auth-code' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      '/oauth/connected?provider=google&error=invalid_callback',
    );
    expect(handleCallback).not.toHaveBeenCalled();

    await app.close();
  });

  it('GET /v1/oauth/:providerId/callback redirects with invalid_state for provider mismatch', async () => {
    const oauthService = createStubOAuthService({
      handleCallback: vi.fn(() => {
        throw new OAuthProviderMismatchError('google', 'other');
      }),
    });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/callback',
      query: { code: 'auth-code', state: 'opaque-state' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      '/oauth/connected?provider=google&error=invalid_state',
    );

    await app.close();
  });

  it('GET /v1/oauth/:providerId/callback redirects with provider_not_configured when provider is missing at callback', async () => {
    const oauthService = createStubOAuthService({
      handleCallback: vi.fn(() => {
        throw new OAuthProviderNotConfiguredError('google');
      }),
    });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/callback',
      query: { code: 'auth-code', state: 'opaque-state' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      '/oauth/connected?provider=google&error=provider_not_configured',
    );

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
      headers: await authHeaders(app, 'web-user'),
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

  it('GET /v1/oauth/:providerId/status requires a bearer token', async () => {
    const app = await createApp(createStubOAuthService());

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/status',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'unauthorized' });

    await app.close();
  });

  it('DELETE /v1/oauth/:providerId disconnects the authenticated user and returns 204', async () => {
    const disconnect = vi.fn(() => Promise.resolve());
    const oauthService = createStubOAuthService({ disconnect });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/oauth/google',
      headers: await authHeaders(app, 'web-user'),
    });

    expect(response.statusCode).toBe(204);
    expect(disconnect).toHaveBeenCalledWith('web-user', 'google');

    await app.close();
  });

  it('returns 404 for an unknown provider id on start', async () => {
    const start = vi.fn();
    const oauthService = createStubOAuthService({ start });
    const app = await createApp(oauthService);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/unknown/start',
      query: { connect_token: await mintConnectToken(app, 'web-user') },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      code: 'provider_not_found',
    });
    expect(start).not.toHaveBeenCalled();

    await app.close();
  });

  it('does not register oauth routes when oauthService is omitted', async () => {
    const app = await buildTestServer({
      requestIdFactory: () => 'req_test00000001',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/oauth/google/start',
      query: { connect_token: 'oct_any' },
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
