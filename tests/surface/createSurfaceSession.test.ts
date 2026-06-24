import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateAgentLlmEndpoint: vi.fn().mockResolvedValue(undefined),
  buildRoleAgentSession: vi.fn().mockResolvedValue({ id: 'sess_test' }),
}));

vi.mock('../../src/config/agentLlm.js', () => ({
  validateAgentLlmEndpoint: mocks.validateAgentLlmEndpoint,
}));

vi.mock('../../src/agent/buildRoleAgentSession.js', () => ({
  buildRoleAgentSession: mocks.buildRoleAgentSession,
}));

import { createSurfaceSession } from '../../src/surface/createSurfaceSession.js';

describe('createSurfaceSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates the LLM endpoint before building the session', async () => {
    const callOrder: string[] = [];
    mocks.validateAgentLlmEndpoint.mockImplementation(async () => {
      callOrder.push('validateAgentLlmEndpoint');
    });
    mocks.buildRoleAgentSession.mockImplementation(async () => {
      callOrder.push('buildRoleAgentSession');
      return { id: 'sess_test' };
    });

    await createSurfaceSession({
      userId: 'user-a',
      sessionId: 'sess_test00000001',
      userMemoryWorkspace: '/data/users/user-a/memory',
      dataRoot: '/data',
      model: {} as never,
      authStorage: {} as never,
      modelRegistry: {} as never,
      surfaceAgentConfig: { thinkingLevel: 'off' } as never,
      taskQueue: {} as never,
      contextTurnLimit: 10,
      enabledIntegrations: [],
    });

    expect(callOrder).toEqual(['validateAgentLlmEndpoint', 'buildRoleAgentSession']);
  });
});
