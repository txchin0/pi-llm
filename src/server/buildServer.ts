import { randomBytes } from 'node:crypto';

import cors from '@fastify/cors';
import Fastify, { type FastifyBaseLogger } from 'fastify';

import { env } from '../config/env.js';

import {
  createChildLogger,
  createRootLogger,
  type AppLogger,
} from '../logging/index.js';
import type { TaskQueue } from '../queue/taskQueue.js';
import type { IntegrationStore } from '../integrations/store/integrationStore.js';
import { OAuthController } from '../integrations/oauth/oauthController.js';
import type { OAuthService } from '../integrations/oauth/oauthService.js';
import { createIntegrationService } from '../integrations/integrationService.js';
import { IntegrationsController } from '../integrations/integrationsController.js';
import {
  RespondController,
  type RespondControllerDependencies,
} from '../respond/respondController.js';
import { ListTasksController } from '../tasks/listTasksController.js';
import { createTaskListService } from '../tasks/taskListService.js';
import { registerIntegrationsRoute } from './routes/integrations.js';
import { registerOAuthRoute } from './routes/oauth.js';
import { registerRespondRoute } from './routes/respond.js';
import { registerTasksRoute } from './routes/tasks.js';

export type BuildServerOptions = RespondControllerDependencies & {
  logger?: AppLogger;
  taskQueue: TaskQueue;
  integrationStore: IntegrationStore;
  oauthService?: OAuthService;
};

/** Creates a Fastify instance with respond, tasks, and integrations routes. */
export function buildServer(options: BuildServerOptions) {
  const {
    logger = createRootLogger(),
    taskQueue,
    integrationStore,
    oauthService,
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

  const allowAll =
    env.CORS_ALLOWED_ORIGINS.length === 1 &&
    env.CORS_ALLOWED_ORIGINS[0] === '*';

  if (allowAll && env.isProd) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS cannot be "*" in production: /v1 routes are unauthenticated and would be scriptable from any website.',
    );
  }

  app.register(cors, {
    origin: allowAll ? '*' : env.CORS_ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    maxAge: 86400,
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

  if (oauthService !== undefined) {
    const oauthController = new OAuthController({
      service: oauthService,
      logger,
    });
    registerOAuthRoute(app, { controller: oauthController, logger });
  }

  return app;
}
