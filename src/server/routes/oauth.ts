import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { OAuthController } from '../../integrations/oauth/oauthController.js';
import { createChildLogger, type AppLogger } from '../../logging/index.js';

type RegisterOAuthRouteOptions = {
  controller: OAuthController;
  logger: AppLogger;
};

/** Sends an HTTP redirect response with the given location header. */
function sendRedirect(reply: FastifyReply, location: string): void {
  reply.status(302).header('location', location).send();
}

/**
 * Registers generic OAuth connect routes under `/v1/oauth/:providerId`.
 *
 * MVP trust model: `user_id` on start/status/disconnect is a trusted query parameter
 * (see DESIGN.md §14.5). When authentication exists, derive `userId` server-side and
 * bind it into signed OAuth state instead of accepting it from the client.
 */
export function registerOAuthRoute(
  app: FastifyInstance,
  options: RegisterOAuthRouteOptions,
): void {
  app.get(
    '/v1/oauth/:providerId/start',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const requestId = request.id;
      const startedAtMs = Date.now();
      const log = createChildLogger(options.logger, {
        component: 'oauth.route',
        request_id: requestId,
      });

      log.debug({ event: 'oauth.start.received' }, 'OAuth start request received');

      let requestError: unknown;

      try {
        const result = await options.controller.handleStart(request.params, request.query, {
          logger: log,
        });

        if (result.status === 302) {
          sendRedirect(reply, result.location);
          return;
        }

        reply
          .status(result.status)
          .header('cache-control', 'no-store')
          .send(result.body);
      } catch (error) {
        requestError = error;
        log.error(
          {
            event: 'oauth.start.failed',
            err: error,
            duration_ms: Date.now() - startedAtMs,
          },
          'OAuth start request failed',
        );
        throw error;
      } finally {
        if (requestError === undefined) {
          log.info(
            {
              event: 'oauth.request.completed',
              method: 'GET',
              route: 'start',
              duration_ms: Date.now() - startedAtMs,
            },
            'OAuth start request completed',
          );
        }
      }
    },
  );

  app.get(
    '/v1/oauth/:providerId/callback',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const requestId = request.id;
      const startedAtMs = Date.now();
      const log = createChildLogger(options.logger, {
        component: 'oauth.route',
        request_id: requestId,
      });

      log.debug({ event: 'oauth.callback.received' }, 'OAuth callback request received');

      let requestError: unknown;

      try {
        const result = await options.controller.handleCallback(
          request.params,
          request.query,
          { logger: log },
        );

        sendRedirect(reply, result.location);
      } catch (error) {
        requestError = error;
        log.error(
          {
            event: 'oauth.callback.failed',
            err: error,
            duration_ms: Date.now() - startedAtMs,
          },
          'OAuth callback request failed',
        );
        throw error;
      } finally {
        if (requestError === undefined) {
          log.info(
            {
              event: 'oauth.request.completed',
              method: 'GET',
              route: 'callback',
              duration_ms: Date.now() - startedAtMs,
            },
            'OAuth callback request completed',
          );
        }
      }
    },
  );

  app.get(
    '/v1/oauth/:providerId/status',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const requestId = request.id;
      const startedAtMs = Date.now();
      const log = createChildLogger(options.logger, {
        component: 'oauth.route',
        request_id: requestId,
      });

      log.debug({ event: 'oauth.status.received' }, 'OAuth status request received');

      let requestError: unknown;

      try {
        const result = await options.controller.handleStatus(request.params, request.query, {
          logger: log,
        });

        reply
          .status(result.status)
          .header('cache-control', 'no-store')
          .send(result.body);
      } catch (error) {
        requestError = error;
        log.error(
          {
            event: 'oauth.status.failed',
            err: error,
            duration_ms: Date.now() - startedAtMs,
          },
          'OAuth status request failed',
        );
        throw error;
      } finally {
        if (requestError === undefined) {
          log.info(
            {
              event: 'oauth.request.completed',
              method: 'GET',
              route: 'status',
              duration_ms: Date.now() - startedAtMs,
            },
            'OAuth status request completed',
          );
        }
      }
    },
  );

  app.delete(
    '/v1/oauth/:providerId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const requestId = request.id;
      const startedAtMs = Date.now();
      const log = createChildLogger(options.logger, {
        component: 'oauth.route',
        request_id: requestId,
      });

      log.debug({ event: 'oauth.disconnect.received' }, 'OAuth disconnect request received');

      let requestError: unknown;

      try {
        const result = await options.controller.handleDisconnect(
          request.params,
          request.query,
          { logger: log },
        );

        reply
          .status(result.status)
          .header('cache-control', 'no-store')
          .send(result.body);
      } catch (error) {
        requestError = error;
        log.error(
          {
            event: 'oauth.disconnect.failed',
            err: error,
            duration_ms: Date.now() - startedAtMs,
          },
          'OAuth disconnect request failed',
        );
        throw error;
      } finally {
        if (requestError === undefined) {
          log.info(
            {
              event: 'oauth.request.completed',
              method: 'DELETE',
              route: 'disconnect',
              duration_ms: Date.now() - startedAtMs,
            },
            'OAuth disconnect request completed',
          );
        }
      }
    },
  );
}
