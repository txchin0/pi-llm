import { randomBytes } from 'node:crypto';

import Fastify, { type FastifyBaseLogger } from 'fastify';

import {
  createChildLogger,
  createRootLogger,
  type AppLogger,
} from '../logging/index.js';
import {
  RespondController,
  type RespondControllerDependencies,
} from '../respond/respondController.js';
import { registerRespondRoute } from './routes/respond.js';

export type BuildServerOptions = RespondControllerDependencies & {
  logger?: AppLogger;
};

/** Creates a Fastify instance with the respond controller and `/v1/respond` route. */
export function buildServer(options: BuildServerOptions = {}) {
  const { logger = createRootLogger(), ...controllerOptions } = options;
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
        event: 'respond.request.failed',
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

  return app;
}
