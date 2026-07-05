import type { FastifyInstance } from 'fastify';

import type { AuthTokensResponse } from '../../src/contracts/auth.js';

export const TEST_PASSWORD = 'test-password-123';

/**
 * Registers a user through the public endpoint and returns the token pair.
 * Idempotent per app instance: if the id is already taken (a prior call in the
 * same test), it logs in instead of failing on the 409.
 */
export async function registerTestUser(
  app: FastifyInstance,
  userId = 'web-user',
): Promise<AuthTokensResponse> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { user_id: userId, password: TEST_PASSWORD },
  });

  if (response.statusCode === 201) {
    return response.json<AuthTokensResponse>();
  }

  if (response.statusCode === 409) {
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { user_id: userId, password: TEST_PASSWORD },
    });
    if (login.statusCode !== 200) {
      throw new Error(`test user login failed: ${login.body}`);
    }
    return login.json<AuthTokensResponse>();
  }

  throw new Error(`test user registration failed: ${response.body}`);
}

/** Registers a user and returns ready-to-spread Authorization headers. */
export async function authHeaders(
  app: FastifyInstance,
  userId = 'web-user',
): Promise<{ authorization: string }> {
  const tokens = await registerTestUser(app, userId);
  return { authorization: `Bearer ${tokens.access_token}` };
}
