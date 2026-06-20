import { describe, expect, it } from 'vitest';

import type { AppLogger } from '../../src/logging/types.js';
import {
  buildAgentModelRegistration,
  checkAgentLlmEndpoint,
  createAgentAuthStorage,
  createAgentModelRegistry,
  resolveAgentModel,
  resolveUserMemoryWorkspace,
  validateAgentLlmEndpoint,
  warnAgentLlmEndpoint,
} from '../../src/config/agentLlm.js';

const surfaceLlmConfig = {
  baseUrl: 'http://127.0.0.1:8080/v1',
  modelId: 'gemma-4-12b-qat',
  apiKey: 'local',
  provider: 'llamacpp',
  contextWindow: 8192,
  maxTokens: 2048,
  thinkingEnabled: false,
  thinkingLevel: 'off' as const,
};

describe('buildAgentModelRegistration', () => {
  it('always advertises reasoning so Pi can toggle llama.cpp thinking', () => {
    expect(
      buildAgentModelRegistration(
        {
          modelId: 'gemma-4-12b-qat',
          contextWindow: 8192,
          maxTokens: 2048,
        },
        'surface',
      ),
    ).toMatchObject({
      name: 'gemma-4-12b-qat (surface)',
      reasoning: true,
      compat: {
        supportsReasoningEffort: true,
        thinkingFormat: 'qwen-chat-template',
      },
    });
  });
});

describe('createAgentModelRegistry', () => {
  it('registers llama.cpp chat-template thinking controls', () => {
    const authStorage = createAgentAuthStorage({
      baseUrl: 'http://127.0.0.1:8080/v1',
      modelId: 'gemma-4-12b-qat',
      apiKey: 'local',
      provider: 'llamacpp',
      contextWindow: 8192,
      maxTokens: 2048,
      thinkingEnabled: false,
      thinkingLevel: 'off',
    });
    const registry = createAgentModelRegistry(authStorage, {
      baseUrl: 'http://127.0.0.1:8080/v1',
      modelId: 'gemma-4-12b-qat',
      apiKey: 'local',
      provider: 'llamacpp',
      contextWindow: 8192,
      maxTokens: 2048,
      thinkingEnabled: false,
      thinkingLevel: 'off',
    }, 'surface');

    expect(resolveAgentModel(registry, {
      baseUrl: 'http://127.0.0.1:8080/v1',
      modelId: 'gemma-4-12b-qat',
      apiKey: 'local',
      provider: 'llamacpp',
      contextWindow: 8192,
      maxTokens: 2048,
      thinkingEnabled: false,
      thinkingLevel: 'off',
    })).toMatchObject({
      reasoning: true,
      compat: {
        thinkingFormat: 'qwen-chat-template',
      },
    });
  });
});

describe('checkAgentLlmEndpoint', () => {
  it('returns ok when the configured model id is listed by the server', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(Response.json({ data: [{ id: 'gemma-4-12b-qat' }] }));

    await expect(
      checkAgentLlmEndpoint(surfaceLlmConfig, 'surface'),
    ).resolves.toEqual({
      ok: true,
    });

    globalThis.fetch = originalFetch;
  });

  it('returns a message when the model id is not listed', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(Response.json({ data: [{ id: 'gemma-4-12b-qat' }] }));

    const result = await checkAgentLlmEndpoint(
      {
        ...surfaceLlmConfig,
        modelId: 'local',
      },
      'surface',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/SURFACE_LLM_MODEL_ID "local"/);
    }

    globalThis.fetch = originalFetch;
  });

  it('returns a message on network failure', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error('connection refused'));

    const result = await checkAgentLlmEndpoint(surfaceLlmConfig, 'surface');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/Cannot reach surface LLM/);
    }

    globalThis.fetch = originalFetch;
  });

  it('uses worker env var name in missing-model messages', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(Response.json({ data: [{ id: 'gemma-4-12b-qat' }] }));

    const result = await checkAgentLlmEndpoint(
      {
        ...surfaceLlmConfig,
        modelId: 'local',
      },
      'worker',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/WORKER_LLM_MODEL_ID "local"/);
    }

    globalThis.fetch = originalFetch;
  });
});

describe('warnAgentLlmEndpoint', () => {
  it('logs a warning and does not throw when the endpoint check fails', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error('connection refused'));

    const warnings: Array<{ obj: object; msg: string | undefined }> = [];
    const log = {
      warn(obj: object, msg?: string) {
        warnings.push({ obj, msg: msg ?? undefined });
      },
    } as Pick<AppLogger, 'warn'>;

    await expect(
      warnAgentLlmEndpoint(surfaceLlmConfig, 'surface', log),
    ).resolves.toBeUndefined();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.obj).toEqual({ event: 'surface.llm.endpoint_warning' });
    expect(warnings[0]?.msg).toMatch(/Cannot reach surface LLM/);

    globalThis.fetch = originalFetch;
  });
});

describe('validateAgentLlmEndpoint', () => {
  it('accepts a configured model id returned by the server', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(Response.json({ data: [{ id: 'gemma-4-12b-qat' }] }));

    await expect(
      validateAgentLlmEndpoint(surfaceLlmConfig, 'surface'),
    ).resolves.toBeUndefined();

    globalThis.fetch = originalFetch;
  });

  it('rejects unknown model ids with available models listed', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(Response.json({ data: [{ id: 'gemma-4-12b-qat' }] }));

    await expect(
      validateAgentLlmEndpoint({ ...surfaceLlmConfig, modelId: 'local' }, 'surface'),
    ).rejects.toThrow(/SURFACE_LLM_MODEL_ID "local"/);

    globalThis.fetch = originalFetch;
  });
});

describe('resolveUserMemoryWorkspace', () => {
  it('places users under the data root', () => {
    expect(resolveUserMemoryWorkspace('./data', 'alice')).toMatch(
      /data[\\/]+users[\\/]+alice[\\/]+memory$/,
    );
  });
});
