import { describe, expect, it } from 'vitest';

import {
  loadWorkerAgentConfig,
  resolveWorkerThinkingLevel,
} from '../../src/config/workerAgent.js';

describe('loadWorkerAgentConfig', () => {
  it('reads WORKER_LLM_* vars with worker defaults', () => {
    expect(
      loadWorkerAgentConfig({
        WORKER_LLM_BASE_URL: 'http://worker-host:9000/v1',
        WORKER_LLM_MODEL_ID: 'worker-model',
        WORKER_LLM_API_KEY: 'secret',
        WORKER_LLM_PROVIDER: 'custom',
        WORKER_LLM_CONTEXT_WINDOW: '16384',
        WORKER_LLM_MAX_TOKENS: '4096',
      }),
    ).toMatchObject({
      baseUrl: 'http://worker-host:9000/v1',
      modelId: 'worker-model',
      apiKey: 'secret',
      provider: 'custom',
      contextWindow: 16384,
      maxTokens: 4096,
      thinkingEnabled: true,
      thinkingLevel: 'low',
    });
  });

  it('defaults thinking on at low when env is empty', () => {
    expect(loadWorkerAgentConfig({})).toMatchObject({
      baseUrl: 'http://127.0.0.1:8080/v1',
      modelId: 'local',
      thinkingEnabled: true,
      thinkingLevel: 'low',
    });
  });

  it('can disable worker thinking', () => {
    expect(
      loadWorkerAgentConfig({
        WORKER_THINKING_ENABLED: 'false',
      }),
    ).toMatchObject({
      thinkingEnabled: false,
      thinkingLevel: 'off',
    });
  });
});

describe('resolveWorkerThinkingLevel', () => {
  it('returns off when thinking is disabled', () => {
    expect(resolveWorkerThinkingLevel(false, 'high')).toBe('off');
  });
});
