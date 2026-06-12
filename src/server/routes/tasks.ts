import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { RequestId } from '../../contracts/respond.js';
import { createChildLogger, type AppLogger } from '../../logging/index.js';
import type { ListTasksController } from '../../tasks/listTasksController.js';

type RegisterTasksRouteOptions = {
  controller: ListTasksController;
  logger: AppLogger;
};

/** Registers `GET /v1/tasks` and returns JSON task summaries for the caller's user_id. */
export function registerTasksRoute(
  app: FastifyInstance,
  options: RegisterTasksRouteOptions,
): void {
  app.get('/v1/tasks', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id as RequestId;
    const startedAtMs = Date.now();
    const log = createChildLogger(options.logger, {
      component: 'tasks.route',
      request_id: requestId,
    });

    log.debug({ event: 'tasks.list.received' }, 'tasks list request received');

    let requestError: unknown;

    try {
      const result = await options.controller.handle(request.query, {
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
          event: 'tasks.list.failed',
          err: error,
          duration_ms: Date.now() - startedAtMs,
        },
        'tasks list request failed',
      );
      throw error;
    } finally {
      if (requestError === undefined) {
        log.info(
          {
            event: 'tasks.list.completed',
            duration_ms: Date.now() - startedAtMs,
          },
          'tasks list request completed',
        );
      }
    }
  });
}
