import { randomBytes } from 'node:crypto';

import Fastify, { type FastifyBaseLogger } from 'fastify';

import {
  createChildLogger,
  createRootLogger,
  type AppLogger,
} from '../logging/index.js';
import { noopTaskQueue } from '../queue/noopTaskQueue.js';
import type { TaskQueue } from '../queue/taskQueue.js';
import { noopIntegrationStore } from '../integrations/store/noopIntegrationStore.js';
import type { IntegrationStore } from '../integrations/store/integrationStore.js';
import { createIntegrationService } from '../integrations/integrationService.js';
import { IntegrationsController } from '../integrations/integrationsController.js';
import {
  RespondController,
  type RespondControllerDependencies,
} from '../respond/respondController.js';
import { ListTasksController } from '../tasks/listTasksController.js';
import { createTaskListService } from '../tasks/taskListService.js';
import { registerIntegrationsRoute } from './routes/integrations.js';
import { registerRespondRoute } from './routes/respond.js';
import { registerTasksRoute } from './routes/tasks.js';

export type BuildServerOptions = RespondControllerDependencies & {
  logger?: AppLogger;
  taskQueue?: TaskQueue;
  integrationStore?: IntegrationStore;
};

/** Creates a Fastify instance with respond, tasks, and integrations routes. */
export function buildServer(options: BuildServerOptions = {}) {
  const {
    logger = createRootLogger(),
    taskQueue = noopTaskQueue,
    integrationStore = noopIntegrationStore,
    ...controllerOptions
  } = options;
  const requestIdFactory =
    controllerOptions.requestIdFactory ??
    (() => `req_${randomBytes(8).toString('hex')}`);

  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    disableRequestLogging: true,
    requestIdHeader: false,
    genReqId: () => requestIdFactory(),
  });

  app.setErrorHandler((error, request, reply) => {
    createChildLogger(logger, { component: 'server' }).error(
      {
        event: 'server.request.failed',
        request_id: request.id,
        err: error,
      },
      'unhandled request error',
    );

    if (!reply.sent) {
      reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  const controller = new RespondController({
    ...controllerOptions,
    logger,
  });
  registerRespondRoute(app, { controller, logger });

  const taskListService = createTaskListService({ taskQueue });
  const listTasksController = new ListTasksController({
    service: taskListService,
    logger,
  });
  registerTasksRoute(app, { controller: listTasksController, logger });

  const integrationService = createIntegrationService({ store: integrationStore });
  const integrationsController = new IntegrationsController({
    service: integrationService,
    logger,
  });
  registerIntegrationsRoute(app, { controller: integrationsController, logger });

  return app;
}
