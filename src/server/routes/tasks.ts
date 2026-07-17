import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { z } from 'zod';

import { createChildLogger, type AppLogger } from '../../logging/index.js';
import type { DismissTaskController } from '../../tasks/dismissTaskController.js';
import type { ListTasksController } from '../../tasks/listTasksController.js';
import { requireUserId } from '../authenticate.js';

type RegisterTasksRouteOptions = {
  controller: ListTasksController;
  dismissController: DismissTaskController;
  authenticate: preHandlerHookHandler;
  logger: AppLogger;
};

const TaskIdParamSchema = z.object({
  taskId: z.unknown(),
});

/** Registers `GET /v1/tasks` and `POST /v1/tasks/:taskId/dismiss` for the authenticated user. */
export function registerTasksRoute(
  app: FastifyInstance,
  options: RegisterTasksRouteOptions,
): void {
  app.get('/v1/tasks', {
    preHandler: options.authenticate,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;
    const startedAtMs = Date.now();
    const log = createChildLogger(options.logger, {
      component: 'tasks.route',
      request_id: requestId,
    });

    log.debug({ event: 'tasks.list.received' }, 'tasks list request received');

    let requestError: unknown;

    try {
      const result = await options.controller.handle(request.query, {
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
            event: 'tasks.request.completed',
            duration_ms: Date.now() - startedAtMs,
          },
          'tasks list request completed',
        );
      }
    }
  });

  app.post('/v1/tasks/:taskId/dismiss', {
    preHandler: options.authenticate,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startedAtMs = Date.now();
    const log = createChildLogger(options.logger, {
      component: 'tasks.route',
      request_id: request.id,
    });

    log.debug({ event: 'tasks.dismiss.received' }, 'task dismiss request received');

    try {
      const params = TaskIdParamSchema.safeParse(request.params);
      const result = await options.dismissController.handle(
        params.success ? params.data.taskId : undefined,
        {
          userId: requireUserId(request),
          logger: log,
        },
      );

      if (result.status === 204) {
        reply.status(204).header('cache-control', 'no-store').send();
        return;
      }

      reply
        .status(result.status)
        .header('cache-control', 'no-store')
        .send(result.body);
    } catch (error) {
      log.error(
        {
          event: 'tasks.dismiss.failed',
          err: error,
          duration_ms: Date.now() - startedAtMs,
        },
        'task dismiss request failed',
      );
      throw error;
    }
  });
}
