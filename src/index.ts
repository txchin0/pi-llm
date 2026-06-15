import { mkdir } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';

import { env } from './config/env.js';
import {
  createSurfaceLlmRuntime,
  surfaceAgentConfig,
} from './config/surfaceAgent.js';
import {
  createWorkerLlmRuntime,
  workerAgentConfig,
} from './config/workerAgent.js';
import { collectProcessShutdownHooks, validateRegistry } from './integrations/registry.js';
import { createFileIntegrationStore } from './integrations/store/fileIntegrationStore.js';
import { createChildLogger, createRootLogger } from './logging/index.js';
import { resolveMigrationsFolder } from './queue/resolveMigrationsFolder.js';
import { resolveTaskDbPath } from './queue/resolveTaskDbPath.js';
import {
  createSqliteTaskQueue,
  type SqliteTaskQueue,
} from './queue/sqliteTaskQueue.js';
import { buildServer } from './server/buildServer.js';
import { createSurfaceRespondService } from './surface/surfaceRespondService.js';
import { SurfaceSessionRegistry } from './surface/surfaceSessionRegistry.js';
import { WorkerLoop } from './worker/workerLoop.js';
import { createWorkerTaskService } from './worker/workerTaskService.js';
import { createWorkerRunTraceSink } from './worker/workerRunTrace.js';

/** Builds the Fastify app and listens on `env.PORT`. */
export async function startServer(): Promise<void> {
  const listenHost = '0.0.0.0';
  const logger = createRootLogger();

  validateRegistry();

  await mkdir(env.DATA_ROOT, { recursive: true });

  const integrationStore = createFileIntegrationStore({ dataRoot: env.DATA_ROOT });

  const surfaceLlm = createSurfaceLlmRuntime(surfaceAgentConfig);
  await surfaceLlm.warnEndpoint(
    createChildLogger(logger, { component: 'surface' }),
  );

  const taskQueue = await createSqliteTaskQueue({
    dbPath: resolveTaskDbPath(env.DATA_ROOT),
    migrationsFolder: resolveMigrationsFolder(),
    log: createChildLogger(logger, { component: 'queue' }),
  });

  const requeuedCount = await taskQueue.requeueStuckRunning();
  if (requeuedCount > 0) {
    createChildLogger(logger, { component: 'queue' }).info(
      {
        event: 'worker.stuck_tasks_requeued',
        count: requeuedCount,
      },
      'requeued stuck running tasks after startup',
    );
  }

  const registry = new SurfaceSessionRegistry({
    dataRoot: env.DATA_ROOT,
    authStorage: surfaceLlm.authStorage,
    modelRegistry: surfaceLlm.modelRegistry,
    model: surfaceLlm.model,
    surfaceAgentConfig,
    taskQueue,
    contextTurnLimit: env.TASK_CONTEXT_TURN_LIMIT,
    maxSessions: env.SURFACE_SESSION_CACHE_LIMIT,
    integrationStore,
    log: createChildLogger(logger, { component: 'surface' }),
  });

  const service = createSurfaceRespondService({ registry, logger });
  const app = buildServer({ logger, service, taskQueue, integrationStore });

  let workerLoop: WorkerLoop | undefined;
  if (env.WORKER_ENABLED) {
    const workerLlm = createWorkerLlmRuntime(workerAgentConfig);
    await workerLlm.warnEndpoint(
      createChildLogger(logger, { component: 'worker' }),
    );

    const workerLog = createChildLogger(logger, { component: 'worker' });

    const workerTaskService = createWorkerTaskService({
      dataRoot: env.DATA_ROOT,
      authStorage: workerLlm.authStorage,
      modelRegistry: workerLlm.modelRegistry,
      model: workerLlm.model,
      workerAgentConfig,
      integrationStore,
      logger: workerLog,
      ...(env.WORKER_RUN_TRACE
        ? {
            createTrace: (task, startedAt) =>
              createWorkerRunTraceSink({
                dataRoot: env.DATA_ROOT,
                task,
                startedAt,
                log: workerLog,
              }),
          }
        : {}),
    });

    workerLoop = new WorkerLoop({
      taskQueue,
      workerTaskService,
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
      maxRetries: env.WORKER_MAX_RETRIES,
      taskTimeoutMs: env.WORKER_TASK_TIMEOUT_MS,
      log: createChildLogger(logger, { component: 'worker' }),
    });
    workerLoop.start();
  }

  registerShutdownHandlers({
    app,
    taskQueue,
    workerLoop,
    logger,
    processShutdownHooks: collectProcessShutdownHooks(),
  });

  try {
    await app.listen({ host: listenHost, port: env.PORT });
    createChildLogger(logger, { component: 'server' }).info(
      {
        event: 'server.started',
        host: listenHost,
        port: env.PORT,
        worker_enabled: env.WORKER_ENABLED,
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

type ShutdownDependencies = {
  app: FastifyInstance;
  taskQueue: SqliteTaskQueue;
  workerLoop?: WorkerLoop | undefined;
  logger: ReturnType<typeof createRootLogger>;
  processShutdownHooks: Array<() => Promise<void> | void>;
};

/** Stops the worker loop, closes integrations, the queue, and Fastify on signals. */
function registerShutdownHandlers(dependencies: ShutdownDependencies): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    createChildLogger(dependencies.logger, { component: 'server' }).info(
      { event: 'server.shutdown', signal },
      'shutting down',
    );

    await dependencies.workerLoop?.stop();

    for (const hook of dependencies.processShutdownHooks) {
      await hook();
    }

    dependencies.taskQueue.close();
    await dependencies.app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}
