import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionId } from '../../src/contracts/respond.js';
import { SurfaceSessionRegistry } from '../../src/surface/surfaceSessionRegistry.js';

const createSurfaceSessionMock = vi.fn();

vi.mock('../../src/surface/createSurfaceSession.js', () => ({
  createSurfaceSession: (...args: unknown[]) => createSurfaceSessionMock(...args),
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
    surfaceAgentConfig: {} as never,
    taskQueue: {
      async enqueue() {
        throw new Error('not used');
      },
      async getById() {
        return null;
      },
      async listByUser() {
        return [];
      },
    },
    contextTurnLimit: 3,
    maxSessions,
  });
}

describe('SurfaceSessionRegistry', () => {
  beforeEach(() => {
    createSurfaceSessionMock.mockReset();
    createSurfaceSessionMock.mockResolvedValue(createSession());
  });

  it('evicts an idle session when inserting past capacity', async () => {
    const registry = createRegistry(1);

    await registry.getOrCreate('sess_a' as SessionId, 'user-a');
    await registry.getOrCreate('sess_b' as SessionId, 'user-b');

    expect(createSurfaceSessionMock).toHaveBeenCalledTimes(2);
  });

  it('does not evict streaming sessions even when at capacity', async () => {
    const registry = createRegistry(1);

    createSurfaceSessionMock.mockResolvedValueOnce(createSession(true));
    await registry.getOrCreate('sess_busy' as SessionId, 'user-a');

    createSurfaceSessionMock.mockResolvedValueOnce(createSession());
    await registry.getOrCreate('sess_new' as SessionId, 'user-b');

    expect(createSurfaceSessionMock).toHaveBeenCalledTimes(2);
  });
});
