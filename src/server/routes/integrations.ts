import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';

import type { IntegrationsController } from '../../integrations/integrationsController.js';
import { createChildLogger, type AppLogger } from '../../logging/index.js';
import { requireUserId } from '../authenticate.js';

type RegisterIntegrationsRouteOptions = {
  controller: IntegrationsController;
  authenticate: preHandlerHookHandler;
  logger: AppLogger;
};

/** Registers `GET` and `PUT /v1/integrations` for listing and updating user integration toggles. */
export function registerIntegrationsRoute(
  app: FastifyInstance,
  options: RegisterIntegrationsRouteOptions,
): void {
  app.get('/v1/integrations', {
    preHandler: options.authenticate,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;
    const startedAtMs = Date.now();
    const log = createChildLogger(options.logger, {
      component: 'integrations.route',
      request_id: requestId,
    });

    log.debug({ event: 'integrations.list.received' }, 'integrations list request received');

    let requestError: unknown;

    try {
      const result = await options.controller.handleList(request.query, {
        userId: requireUserId(request),
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
          event: 'integrations.list.failed',
          err: error,
          duration_ms: Date.now() - startedAtMs,
        },
        'integrations list request failed',
      );
      throw error;
    } finally {
      if (requestError === undefined) {
        log.info(
          {
            event: 'integrations.request.completed',
            method: 'GET',
            duration_ms: Date.now() - startedAtMs,
          },
          'integrations list request completed',
        );
      }
    }
  });

  app.put('/v1/integrations', {
    preHandler: options.authenticate,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;
    const startedAtMs = Date.now();
    const log = createChildLogger(options.logger, {
      component: 'integrations.route',
      request_id: requestId,
    });

    log.debug({ event: 'integrations.update.received' }, 'integrations update request received');

    let requestError: unknown;

    try {
      const result = await options.controller.handleUpdate(request.body, {
        userId: requireUserId(request),
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
          event: 'integrations.update.failed',
          err: error,
          duration_ms: Date.now() - startedAtMs,
        },
        'integrations update request failed',
      );
      throw error;
    } finally {
      if (requestError === undefined) {
        log.info(
          {
            event: 'integrations.request.completed',
            method: 'PUT',
            duration_ms: Date.now() - startedAtMs,
          },
          'integrations update request completed',
        );
      }
    }
  });
}
