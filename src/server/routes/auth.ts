import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AuthController } from '../../auth/authController.js';
import { createChildLogger, type AppLogger } from '../../logging/index.js';

type RegisterAuthRouteOptions = {
  controller: AuthController;
  logger: AppLogger;
};

type AuthHandler = (
  rawBody: unknown,
  options: { logger: AppLogger },
) => Promise<{ status: number; body: unknown }>;

/**
 * Registers the public `POST /v1/auth/*` endpoints. These are the only /v1
 * routes reachable without a bearer token (they mint them). Rate limiting is
 * a later concern; add it here (per-route config) when it lands.
 */
export function registerAuthRoute(
  app: FastifyInstance,
  options: RegisterAuthRouteOptions,
): void {
  const register = (path: string, name: string, handler: AuthHandler) => {
    app.post(`/v1/auth/${path}`, async (request: FastifyRequest, reply: FastifyReply) => {
      const requestId = request.id;
      const startedAtMs = Date.now();
      const log = createChildLogger(options.logger, {
        component: 'auth.route',
        request_id: requestId,
      });

      log.debug({ event: `auth.${name}.received` }, `auth ${name} request received`);

      let requestError: unknown;

      try {
        const result = await handler(request.body, { logger: log });

        reply
          .status(result.status)
          .header('cache-control', 'no-store')
          .send(result.body);
      } catch (error) {
        requestError = error;
        log.error(
          {
            event: `auth.${name}.failed`,
            err: error,
            duration_ms: Date.now() - startedAtMs,
          },
          `auth ${name} request failed`,
        );
        throw error;
      } finally {
        if (requestError === undefined) {
          log.info(
            {
              event: 'auth.request.completed',
              route: name,
              duration_ms: Date.now() - startedAtMs,
            },
            `auth ${name} request completed`,
          );
        }
      }
    });
  };

  const controller = options.controller;
  register('register', 'register', (body, opts) => controller.handleRegister(body, opts));
  register('login', 'login', (body, opts) => controller.handleLogin(body, opts));
  register('refresh', 'refresh', (body, opts) => controller.handleRefresh(body, opts));
  register('logout', 'logout', (body, opts) => controller.handleLogout(body, opts));
}
