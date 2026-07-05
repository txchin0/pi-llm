import { createAuthService } from '../../src/auth/authService.js';
import { createScryptPasswordHasher } from '../../src/auth/passwordHasher.js';
import { createSqliteAuthStore } from '../../src/auth/sqliteAuthStore.js';
import { resolveMigrationsFolder } from '../../src/queue/resolveMigrationsFolder.js';
import {
  buildServer,
  type BuildServerOptions,
} from '../../src/server/buildServer.js';
import { createEmptyIntegrationStore } from './emptyIntegrationStore.js';
import { createMockTaskQueue } from './mockTaskQueue.js';
import { createStubRespondService } from './stubRespondService.js';

/** Creates a real auth service backed by an in-memory SQLite store. */
export async function createTestAuthService() {
  const store = await createSqliteAuthStore({
    dbPath: ':memory:',
    migrationsFolder: resolveMigrationsFolder(),
  });
  return createAuthService({
    store,
    hasher: createScryptPasswordHasher(),
    jwtSecret: 'test-jwt-secret',
  });
}

/** Builds a Fastify app with stub respond, task queue, integration store, and auth defaults. */
export async function buildTestServer(
  overrides: Partial<BuildServerOptions> = {},
) {
  return buildServer({
    service: createStubRespondService(),
    taskQueue: createMockTaskQueue(),
    integrationStore: createEmptyIntegrationStore(),
    authService: overrides.authService ?? (await createTestAuthService()),
    ...overrides,
  });
}
