import { randomBytes } from 'node:crypto';

import cors from '@fastify/cors';
import Fastify, { type FastifyBaseLogger } from 'fastify';

import { env } from '../config/env.js';

import { AuthController } from '../auth/authController.js';
import type { AuthService } from '../auth/authService.js';
import {
  createChildLogger,
  createRootLogger,
  type AppLogger,
} from '../logging/index.js';
import type { TaskQueue } from '../queue/taskQueue.js';
import type { IntegrationStore } from '../integrations/store/integrationStore.js';
import { createInMemoryConnectTokenStore } from '../integrations/oauth/connectTokenStore.js';
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
import { createAuthenticate } from './authenticate.js';
import { registerAuthRoute } from './routes/auth.js';
import { registerIntegrationsRoute } from './routes/integrations.js';
import { registerOAuthRoute } from './routes/oauth.js';
import { registerRespondRoute } from './routes/respond.js';
import { registerTasksRoute } from './routes/tasks.js';

export type BuildServerOptions = RespondControllerDependencies & {
  logger?: AppLogger;
  taskQueue: TaskQueue;
  integrationStore: IntegrationStore;
  authService: AuthService;
  oauthService?: OAuthService;
};

/** Creates a Fastify instance with respond, tasks, and integrations routes. */
export function buildServer(options: BuildServerOptions) {
  const {
    logger = createRootLogger(),
    taskQueue,
    integrationStore,
    authService,
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
    // /v1 requires bearer auth (no cookies), so a foreign origin cannot ride
    // an existing session — "*" is tolerable, but an explicit allowlist still
    // shrinks the surface for token-phishing pages. Prefer setting it.
    createChildLogger(logger, { component: 'server' }).warn(
      { event: 'server.cors.allow_all' },
      'CORS_ALLOWED_ORIGINS is "*" in production; prefer an explicit origin allowlist',
    );
  }

  app.register(cors, {
    origin: allowAll ? '*' : env.CORS_ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
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

  const authenticate = createAuthenticate({
    verifyAccess: (token) => authService.verifyAccess(token),
  });

  const authController = new AuthController({ service: authService, logger });
  registerAuthRoute(app, { controller: authController, logger });

  const controller = new RespondController({
    ...controllerOptions,
    logger,
  });
  registerRespondRoute(app, { controller, authenticate, logger });

  const taskListService = createTaskListService({ taskQueue });
  const listTasksController = new ListTasksController({
    service: taskListService,
    logger,
  });
  registerTasksRoute(app, { controller: listTasksController, authenticate, logger });

  const integrationService = createIntegrationService({ store: integrationStore });
  const integrationsController = new IntegrationsController({
    service: integrationService,
    logger,
  });
  registerIntegrationsRoute(app, {
    controller: integrationsController,
    authenticate,
    logger,
  });

  if (oauthService !== undefined) {
    const oauthController = new OAuthController({
      service: oauthService,
      connectTokenStore: createInMemoryConnectTokenStore(),
      logger,
    });
    registerOAuthRoute(app, { controller: oauthController, authenticate, logger });
  }

  return app;
}
