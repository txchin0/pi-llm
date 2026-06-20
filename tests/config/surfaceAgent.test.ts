import { describe, expect, it } from 'vitest';

import {
  loadSurfaceAgentConfig,
  resolveSurfaceThinkingLevel,
} from '../../src/config/surfaceAgent.js';

describe('loadSurfaceAgentConfig', () => {
  it('applies defaults for surface LLM settings', () => {
    expect(loadSurfaceAgentConfig({})).toMatchObject({
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

  it('enables thinking with a configured level', () => {
    expect(
      loadSurfaceAgentConfig({
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

  it('rejects invalid base URLs', () => {
    expect(() =>
      loadSurfaceAgentConfig({
        SURFACE_LLM_BASE_URL: 'not-a-url',
      }),
    ).toThrow(/SURFACE_LLM_BASE_URL/);
  });

  it('rejects invalid thinking levels', () => {
    expect(() =>
      loadSurfaceAgentConfig({
        SURFACE_THINKING_ENABLED: 'true',
        SURFACE_THINKING_LEVEL: 'turbo',
      }),
    ).toThrow(/SURFACE_THINKING_LEVEL/);
  });
});

describe('resolveSurfaceThinkingLevel', () => {
  it('returns off when thinking is disabled', () => {
    expect(resolveSurfaceThinkingLevel(false, 'high')).toBe('off');
  });
});
