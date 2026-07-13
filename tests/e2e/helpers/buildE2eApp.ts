import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import type { FastifyInstance } from 'fastify';

import { createAuthService } from '../../../src/auth/authService.js';
import { createScryptPasswordHasher } from '../../../src/auth/passwordHasher.js';
import { createSqliteAuthStore } from '../../../src/auth/sqliteAuthStore.js';
import { createAgentLlmRuntime } from '../../../src/config/agentLlm.js';
import { validateRegistry } from '../../../src/integrations/registry.js';
import { createFileIntegrationStore } from '../../../src/integrations/store/fileIntegrationStore.js';
import { createChildLogger, createRootLogger } from '../../../src/logging/index.js';
import { resolveMigrationsFolder } from '../../../src/queue/resolveMigrationsFolder.js';
import { resolveTaskDbPath } from '../../../src/queue/resolveTaskDbPath.js';
import {
  createSqliteTaskQueue,
  type SqliteTaskQueue,
} from '../../../src/queue/sqliteTaskQueue.js';
import { buildServer } from '../../../src/server/buildServer.js';
import { createSurfaceRespondService } from '../../../src/surface/surfaceRespondService.js';
import { SurfaceSessionRegistry } from '../../../src/surface/surfaceSessionRegistry.js';
import { WorkerLoop } from '../../../src/worker/workerLoop.js';
import { createWorkerRunTraceSink } from '../../../src/worker/workerRunTrace.js';
import { createWorkerTaskService } from '../../../src/worker/workerTaskService.js';

import {
  createFakeOAuthService,
  type FakeOAuthService,
} from '../fakes/fakeOAuthService.js';
import { fakeCalendarStore, type FakeCalendarStore } from '../fakes/fakeGoogleApis.js';
import { fakeExaCalls, type FakeExaCall } from '../fakes/fakeExaMcpClient.js';
import { resolveE2eRuntimeConfig, type E2eRuntimeConfig } from './e2eEnv.js';

export type BuildE2eAppOptions = {
  /** Worker queue poll interval; short by default to keep scenarios fast. */
  workerPollMs?: number;
  /** Which users the fake OAuth service reports as Google-connected. */
  connectedGoogleUserIds?: 'all' | string[];
};

export type E2eFakes = {
  calendar: FakeCalendarStore;
  exaCalls: FakeExaCall[];
  oauth: FakeOAuthService;
};

export type E2eAppHandle = {
  app: FastifyInstance;
  taskQueue: SqliteTaskQueue;
  dataRoot: string;
  config: E2eRuntimeConfig;
  fakes: E2eFakes;
  close(): Promise<void>;
};

/**
 * Composes the real production pipeline for e2e tests, mirroring
 * `startServer()` in `src/index.ts`: real respond service, session registry,
 * surface/worker LLM runtimes, file-backed SQLite queue + auth store in a temp
 * DATA_ROOT, and a running worker loop. Deviations from production: no
 * `listen()` (tests drive `app.inject`), a fake OAuth service instead of the
 * file token store, and no integration startup hooks (googleapis is faked).
 *
 * The googleapis and Exa fakes only take effect when the scenario file mocks
 * their modules — see the vi.mock lines documented in `scenario.ts`.
 */
export async function buildE2eApp(
  options: BuildE2eAppOptions = {},
): Promise<E2eAppHandle> {
  const config = await resolveE2eRuntimeConfig();
  const logger = createRootLogger();

  validateRegistry();

  const dataRoot = await mkdtemp(join(tmpdir(), 'pi-llm-e2e-'));
  const integrationStore = createFileIntegrationStore({ dataRoot });
  const oauthService = createFakeOAuthService({
    connectedUserIds: options.connectedGoogleUserIds ?? 'all',
  });

  const surfaceLlm = createAgentLlmRuntime(config.surface, { role: 'surface' });

  const taskQueue = await createSqliteTaskQueue({
    dbPath: resolveTaskDbPath(dataRoot),
    migrationsFolder: resolveMigrationsFolder(),
    log: createChildLogger(logger, { component: 'queue' }),
  });

  const authStore = await createSqliteAuthStore({
    dbPath: resolveTaskDbPath(dataRoot),
    migrationsFolder: resolveMigrationsFolder(),
  });
  const authService = createAuthService({
    store: authStore,
    hasher: createScryptPasswordHasher(),
    jwtSecret: 'e2e-jwt-secret',
  });

  const registry = new SurfaceSessionRegistry({
    dataRoot,
    authStorage: surfaceLlm.authStorage,
    modelRegistry: surfaceLlm.modelRegistry,
    model: surfaceLlm.model,
    agentConfig: config.surface,
    taskQueue,
    contextTurnLimit: 3,
    maxSessions: 50,
    integrationStore,
    oauthService,
    log: createChildLogger(logger, { component: 'surface' }),
  });

  const service = createSurfaceRespondService({ registry, logger });
  const app = buildServer({
    logger,
    service,
    taskQueue,
    integrationStore,
    authService,
  });

  const workerLlm = createAgentLlmRuntime(config.worker, { role: 'worker' });
  const workerLog = createChildLogger(logger, { component: 'worker' });
  const workerTaskService = createWorkerTaskService({
    dataRoot,
    authStorage: workerLlm.authStorage,
    modelRegistry: workerLlm.modelRegistry,
    model: workerLlm.model,
    agentConfig: config.worker,
    integrationStore,
    oauthService,
    logger: workerLog,
    createTrace: (task, startedAt) =>
      createWorkerRunTraceSink({ dataRoot, task, startedAt, log: workerLog }),
  });

  const workerLoop = new WorkerLoop({
    taskQueue,
    workerTaskService,
    pollIntervalMs: options.workerPollMs ?? 200,
    // One retry keeps the retry path exercised while bounding scenario time.
    maxRetries: 1,
    taskTimeoutMs: config.workerTaskTimeoutMs,
    log: workerLog,
  });
  workerLoop.start();

  return {
    app,
    taskQueue,
    dataRoot,
    config,
    fakes: {
      calendar: fakeCalendarStore,
      exaCalls: fakeExaCalls,
      oauth: oauthService,
    },
    async close() {
      await workerLoop.stop();
      taskQueue.close();
      authStore.close();
      await app.close();
      await removeDataRoot(dataRoot);
    },
  };
}

/**
 * Removes the temp DATA_ROOT with retries: on Windows, better-sqlite3 file
 * handles can release a beat after `close()`. Cleanup failure only warns —
 * a leftover temp dir must never fail the suite.
 */
async function removeDataRoot(dataRoot: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rm(dataRoot, { recursive: true, force: true });
      return;
    } catch {
      await sleep(200);
    }
  }

  try {
    await rm(dataRoot, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      `[e2e] failed to remove temp data root ${dataRoot}: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
}
