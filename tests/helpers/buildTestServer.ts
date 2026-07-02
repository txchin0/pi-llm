import {
  buildServer,
  type BuildServerOptions,
} from '../../src/server/buildServer.js';
import { createEmptyIntegrationStore } from './emptyIntegrationStore.js';
import { createMockTaskQueue } from './mockTaskQueue.js';
import { createStubRespondService } from './stubRespondService.js';

/** Builds a Fastify app with stub respond, task queue, and integration store defaults. */
export function buildTestServer(
  overrides: Partial<BuildServerOptions> = {},
) {
  return buildServer({
    service: createStubRespondService(),
    taskQueue: createMockTaskQueue(),
    integrationStore: createEmptyIntegrationStore(),
    ...overrides,
  });
}
