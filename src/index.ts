import { mkdir } from 'node:fs/promises';

import { env } from './config/env.js';
import {
  createSurfaceAuthStorage,
  createSurfaceModelRegistry,
  resolveSurfaceModel,
  surfaceAgentConfig,
  warnSurfaceLlmEndpoint,
} from './config/surfaceAgent.js';
import { createChildLogger, createRootLogger } from './logging/index.js';
import { resolveMigrationsFolder } from './queue/resolveMigrationsFolder.js';
import { resolveTaskDbPath } from './queue/resolveTaskDbPath.js';
import { createSqliteTaskQueue } from './queue/sqliteTaskQueue.js';
import { buildServer } from './server/buildServer.js';
import { createSurfaceRespondService } from './surface/surfaceRespondService.js';
import { SurfaceSessionRegistry } from './surface/surfaceSessionRegistry.js';

/** Builds the Fastify app and listens on `env.PORT`. */
export async function startServer(): Promise<void> {
  const listenHost = '0.0.0.0';
  const logger = createRootLogger();

  await mkdir(env.DATA_ROOT, { recursive: true });

  await warnSurfaceLlmEndpoint(
    surfaceAgentConfig,
    createChildLogger(logger, { component: 'surface' }),
  );

  const authStorage = createSurfaceAuthStorage();
  const modelRegistry = createSurfaceModelRegistry(authStorage);
  const model = resolveSurfaceModel(modelRegistry);

  const taskQueue = await createSqliteTaskQueue({
    dbPath: resolveTaskDbPath(env.DATA_ROOT),
    migrationsFolder: resolveMigrationsFolder(),
    log: createChildLogger(logger, { component: 'queue' }),
  });

  const registry = new SurfaceSessionRegistry({
    dataRoot: env.DATA_ROOT,
    authStorage,
    modelRegistry,
    model,
    surfaceAgentConfig,
    taskQueue,
    contextTurnLimit: env.TASK_CONTEXT_TURN_LIMIT,
    maxSessions: env.SURFACE_SESSION_CACHE_LIMIT,
    log: createChildLogger(logger, { component: 'surface' }),
  });

  const service = createSurfaceRespondService({ registry, logger });
  const app = buildServer({ logger, service, taskQueue });

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
