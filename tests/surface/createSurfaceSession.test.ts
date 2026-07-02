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

import { unconfiguredOAuthService } from '../../src/integrations/oauth/unconfiguredOAuthService.js';
import { createSurfaceSession } from '../../src/surface/createSurfaceSession.js';

describe('createSurfaceSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates the LLM endpoint before building the session', async () => {
    const callOrder: string[] = [];
    mocks.validateAgentLlmEndpoint.mockImplementation(() => {
      callOrder.push('validateAgentLlmEndpoint');
      return Promise.resolve();
    });
    mocks.buildRoleAgentSession.mockImplementation(() => {
      callOrder.push('buildRoleAgentSession');
      return Promise.resolve({ id: 'sess_test' });
    });

    await createSurfaceSession({
      userId: 'user-a',
      sessionId: 'sess_test00000001',
      userMemoryWorkspace: '/data/users/user-a/memory',
      dataRoot: '/data',
      model: {} as never,
      authStorage: {} as never,
      modelRegistry: {} as never,
      agentConfig: { thinkingLevel: 'off' } as never,
      taskQueue: {} as never,
      contextTurnLimit: 10,
      enabledIntegrations: [],
      oauthService: unconfiguredOAuthService,
    });

    expect(callOrder).toEqual(['validateAgentLlmEndpoint', 'buildRoleAgentSession']);
  });
});
