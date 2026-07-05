import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

import type { AuthService } from '../auth/authService.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Authenticated user id, set by the auth pre-handler. */
    userId?: string;
  }
}

export type AuthenticateOptions = {
  verifyAccess: AuthService['verifyAccess'];
};

/**
 * Builds the bearer-token pre-handler applied to every protected /v1 route.
 * On success the derived user id is attached to the request; identity is
 * never taken from client-supplied bodies or query strings.
 */
export function createAuthenticate(
  options: AuthenticateOptions,
): preHandlerHookHandler {
  return function authenticate(request: FastifyRequest, reply: FastifyReply, done) {
    const header = request.headers.authorization;
    const token =
      header !== undefined && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length).trim()
        : undefined;

    const verified = token !== undefined ? options.verifyAccess(token) : undefined;

    if (verified === undefined) {
      reply
        .status(401)
        .header('cache-control', 'no-store')
        .header('www-authenticate', 'Bearer')
        .send({
          code: 'unauthorized',
          message: 'A valid access token is required.',
        });
      done();
      return;
    }

    request.userId = verified.userId;
    done();
  };
}

/** Returns the authenticated user id; throws if the route skipped the auth pre-handler. */
export function requireUserId(request: FastifyRequest): string {
  if (request.userId === undefined) {
    throw new Error('Route is missing the authenticate pre-handler.');
  }
  return request.userId;
}
