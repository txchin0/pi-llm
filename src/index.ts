import { env } from './config/env.js';
import {
  createSurfaceAuthStorage,
  createSurfaceModelRegistry,
  resolveSurfaceModel,
  surfaceAgentConfig,
  warnSurfaceLlmEndpoint,
} from './config/surfaceAgent.js';
import { createChildLogger, createRootLogger } from './logging/index.js';
import { createSurfaceRespondHandler } from './runtime/surface/surfaceRespondHandler.js';
import { SurfaceSessionRegistry } from './runtime/surface/surfaceSessionRegistry.js';
import { buildServer } from './server/buildServer.js';

/** Builds the Fastify app and listens on `env.PORT`. */
export async function startServer(): Promise<void> {
  const listenHost = '0.0.0.0';
  const logger = createRootLogger();
  await warnSurfaceLlmEndpoint(
    surfaceAgentConfig,
    createChildLogger(logger, { component: 'surface' }),
  );
  const authStorage = createSurfaceAuthStorage();
  const modelRegistry = createSurfaceModelRegistry(authStorage);
  const model = resolveSurfaceModel(modelRegistry);
  const registry = new SurfaceSessionRegistry({
    dataRoot: env.DATA_ROOT,
    authStorage,
    modelRegistry,
    model,
    surfaceAgentConfig,
  });
  const handler = createSurfaceRespondHandler({ registry, logger });
  const app = buildServer({ logger, handler });

  try {
    await app.listen({ host: listenHost, port: env.PORT });
    createChildLogger(logger, { component: 'server' }).info(
      {
        event: 'server.started',
        host: listenHost,
        port: env.PORT,
      },
      `pi-llm listening on http://${listenHost}:${env.PORT}`,
    );
  } catch (error) {
    createChildLogger(logger, { component: 'server' }).error(
      {
        event: 'server.start_failed',
        err: error,
      },
      'failed to start server',
    );
    process.exitCode = 1;
  }
}
