import { describe, expect, it } from 'vitest';

import { AuthTokensResponseSchema } from '../../src/contracts/auth.js';
import { registerTestUser, TEST_PASSWORD } from '../helpers/auth.js';
import { buildTestServer } from '../helpers/buildTestServer.js';

describe('auth routes', () => {
  it('POST /v1/auth/register creates an account and returns a token pair', async () => {
    const app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { user_id: 'alice', password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');

    const body = AuthTokensResponseSchema.parse(response.json());
    expect(body.user_id).toBe('alice');
    expect(body.access_token.split('.')).toHaveLength(3);
    expect(body.refresh_token.startsWith('rt_')).toBe(true);

    await app.close();
  });

  it('POST /v1/auth/register rejects a taken user id with 409', async () => {
    const app = await buildTestServer();
    await registerTestUser(app, 'alice');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { user_id: 'alice', password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'user_exists' });

    await app.close();
  });

  it('POST /v1/auth/register rejects malformed user ids and short passwords', async () => {
    const app = await buildTestServer();

    const badId = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { user_id: 'not a valid id!', password: TEST_PASSWORD },
    });
    expect(badId.statusCode).toBe(400);
    expect(badId.json()).toMatchObject({ code: 'validation_error' });

    const shortPassword = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { user_id: 'alice', password: 'short' },
    });
    expect(shortPassword.statusCode).toBe(400);
    expect(shortPassword.json()).toMatchObject({ code: 'validation_error' });

    await app.close();
  });

  it('POST /v1/auth/login returns tokens for valid credentials', async () => {
    const app = await buildTestServer();
    await registerTestUser(app, 'alice');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { user_id: 'alice', password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    const body = AuthTokensResponseSchema.parse(response.json());
    expect(body.user_id).toBe('alice');

    await app.close();
  });

  it('POST /v1/auth/login returns 401 for a wrong password or unknown user', async () => {
    const app = await buildTestServer();
    await registerTestUser(app, 'alice');

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { user_id: 'alice', password: 'wrong-password' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongPassword.json()).toMatchObject({ code: 'invalid_credentials' });

    const unknownUser = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { user_id: 'nobody', password: TEST_PASSWORD },
    });
    expect(unknownUser.statusCode).toBe(401);
    expect(unknownUser.json()).toMatchObject({ code: 'invalid_credentials' });

    await app.close();
  });

  it('POST /v1/auth/refresh rotates the pair and keeps the old token valid within the grace window', async () => {
    const app = await buildTestServer();
    const initial = await registerTestUser(app, 'alice');

    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: initial.refresh_token },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = AuthTokensResponseSchema.parse(first.json());
    expect(firstBody.refresh_token).not.toBe(initial.refresh_token);

    // Same original token replayed immediately (two-client race): allowed
    // within the grace window and mints another pair.
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: initial.refresh_token },
    });
    expect(replay.statusCode).toBe(200);

    // The rotated token works too.
    const second = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: firstBody.refresh_token },
    });
    expect(second.statusCode).toBe(200);

    await app.close();
  });

  it('POST /v1/auth/refresh returns 401 for unknown tokens', async () => {
    const app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: 'rt_forged' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'invalid_refresh_token' });

    await app.close();
  });

  it('POST /v1/auth/logout revokes the refresh token', async () => {
    const app = await buildTestServer();
    const tokens = await registerTestUser(app, 'alice');

    const logout = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(logout.statusCode).toBe(204);

    const refresh = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(refresh.statusCode).toBe(401);

    // Idempotent: logging out again is still a 204.
    const again = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(again.statusCode).toBe(204);

    await app.close();
  });

  it('access tokens from register authenticate protected routes', async () => {
    const app = await buildTestServer();
    const tokens = await registerTestUser(app, 'alice');

    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });

    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it('rejects garbage and forged bearer tokens with 401', async () => {
    const app = await buildTestServer();
    const tokens = await registerTestUser(app, 'alice');
    const forged = `${tokens.access_token.slice(0, -2)}xx`;

    for (const token of ['garbage', forged]) {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/tasks',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(401);
    }

    await app.close();
  });
});
