import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SurfaceSessionRegistry } from '../../src/surface/surfaceSessionRegistry.js';
import { unconfiguredOAuthService } from '../../src/integrations/oauth/unconfiguredOAuthService.js';
import { createEmptyIntegrationStore } from '../helpers/emptyIntegrationStore.js';
import { createMockTaskQueue } from '../helpers/mockTaskQueue.js';

const createSurfaceSessionMock = vi.fn<
  (sessionId: string, userId: string) => Promise<{ isStreaming: boolean }>
>();

vi.mock('../../src/surface/createSurfaceSession.js', () => ({
  createSurfaceSession: (
    sessionId: string,
    userId: string,
  ): ReturnType<typeof createSurfaceSessionMock> =>
    createSurfaceSessionMock(sessionId, userId),
}));

function createSession(isStreaming = false) {
  return {
    isStreaming,
  };
}

function createRegistry(maxSessions: number) {
  return new SurfaceSessionRegistry({
    dataRoot: '/data',
    authStorage: {} as never,
    modelRegistry: {} as never,
    model: {} as never,
    agentConfig: {} as never,
    taskQueue: createMockTaskQueue(),
    contextTurnLimit: 3,
    maxSessions,
    integrationStore: createEmptyIntegrationStore(),
    oauthService: unconfiguredOAuthService,
  });
}

describe('SurfaceSessionRegistry', () => {
  beforeEach(() => {
    createSurfaceSessionMock.mockReset();
    createSurfaceSessionMock.mockResolvedValue(createSession());
  });

  it('evicts an idle session when inserting past capacity', async () => {
    const registry = createRegistry(1);

    await registry.getOrCreate('sess_a', 'user-a');
    await registry.getOrCreate('sess_b', 'user-b');

    expect(createSurfaceSessionMock).toHaveBeenCalledTimes(2);
  });

  it('does not evict streaming sessions even when at capacity', async () => {
    const registry = createRegistry(1);

    createSurfaceSessionMock.mockResolvedValueOnce(createSession(true));
    await registry.getOrCreate('sess_busy', 'user-a');

    createSurfaceSessionMock.mockResolvedValueOnce(createSession());
    await registry.getOrCreate('sess_new', 'user-b');

    expect(createSurfaceSessionMock).toHaveBeenCalledTimes(2);
  });
});
