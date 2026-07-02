import { describe, expect, it } from 'vitest';

import { loadRoleAgentConfig } from '../../src/config/agentLlm.js';

describe('loadRoleAgentConfig', () => {
  it('applies surface defaults with thinking disabled', () => {
    expect(loadRoleAgentConfig('surface', {})).toMatchObject({
      baseUrl: 'http://127.0.0.1:8080/v1',
      modelId: 'local',
      apiKey: 'local',
      provider: 'llamacpp',
      contextWindow: 8192,
      maxTokens: 2048,
      thinkingEnabled: false,
      thinkingLevel: 'off',
    });
  });

  it('applies worker defaults with thinking enabled', () => {
    expect(loadRoleAgentConfig('worker', {})).toMatchObject({
      baseUrl: 'http://127.0.0.1:8080/v1',
      modelId: 'local',
      apiKey: 'local',
      provider: 'llamacpp',
      contextWindow: 8192,
      maxTokens: 2048,
      thinkingEnabled: true,
      thinkingLevel: 'low',
    });
  });

  it('reads surface settings from SURFACE_-prefixed env vars', () => {
    expect(
      loadRoleAgentConfig('surface', {
        SURFACE_THINKING_ENABLED: 'true',
        SURFACE_THINKING_LEVEL: 'medium',
        SURFACE_LLM_BASE_URL: 'http://localhost:8080/v1',
      }),
    ).toMatchObject({
      thinkingEnabled: true,
      thinkingLevel: 'medium',
      baseUrl: 'http://localhost:8080/v1',
    });
  });

  it('reads worker settings from WORKER_-prefixed env vars', () => {
    expect(
      loadRoleAgentConfig('worker', {
        WORKER_THINKING_ENABLED: 'false',
        WORKER_LLM_MODEL_ID: 'worker-model',
      }),
    ).toMatchObject({
      thinkingEnabled: false,
      thinkingLevel: 'off',
      modelId: 'worker-model',
    });
  });

  it('ignores the other role’s prefix', () => {
    expect(
      loadRoleAgentConfig('surface', {
        WORKER_LLM_MODEL_ID: 'worker-model',
      }),
    ).toMatchObject({ modelId: 'local' });
  });

  it('rejects invalid base URLs with the role-prefixed env name', () => {
    expect(() =>
      loadRoleAgentConfig('surface', {
        SURFACE_LLM_BASE_URL: 'not-a-url',
      }),
    ).toThrow(/SURFACE_LLM_BASE_URL/);
  });

  it('rejects invalid thinking levels with the role-prefixed env name', () => {
    expect(() =>
      loadRoleAgentConfig('worker', {
        WORKER_THINKING_ENABLED: 'true',
        WORKER_THINKING_LEVEL: 'turbo',
      }),
    ).toThrow(/WORKER_THINKING_LEVEL/);
  });
});
