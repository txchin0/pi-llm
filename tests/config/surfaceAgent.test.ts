import { describe, expect, it } from 'vitest';

import type { AppLogger } from '../../src/logging/types.js';
import {
  buildSurfaceModelRegistration,
  checkSurfaceLlmEndpoint,
  createSurfaceAuthStorage,
  createSurfaceModelRegistry,
  loadSurfaceAgentConfig,
  resolveSurfaceModel,
  resolveSurfaceThinkingLevel,
  resolveUserMemoryWorkspace,
  validateSurfaceLlmEndpoint,
  warnSurfaceLlmEndpoint,
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

describe('buildSurfaceModelRegistration', () => {
  it('always advertises reasoning so Pi can toggle llama.cpp thinking', () => {
    expect(
      buildSurfaceModelRegistration({
        modelId: 'gemma-4-12b-qat',
        contextWindow: 8192,
        maxTokens: 2048,
      }),
    ).toMatchObject({
      reasoning: true,
      compat: {
        supportsReasoningEffort: true,
        thinkingFormat: 'qwen-chat-template',
      },
    });
  });
});

describe('createSurfaceModelRegistry', () => {
  it('registers llama.cpp chat-template thinking controls', () => {
    const authStorage = createSurfaceAuthStorage({
      baseUrl: 'http://127.0.0.1:8080/v1',
      modelId: 'gemma-4-12b-qat',
      apiKey: 'local',
      provider: 'llamacpp',
      contextWindow: 8192,
      maxTokens: 2048,
      thinkingEnabled: false,
      thinkingLevel: 'off',
    });
    const registry = createSurfaceModelRegistry(authStorage, {
      baseUrl: 'http://127.0.0.1:8080/v1',
      modelId: 'gemma-4-12b-qat',
      apiKey: 'local',
      provider: 'llamacpp',
      contextWindow: 8192,
      maxTokens: 2048,
      thinkingEnabled: false,
      thinkingLevel: 'off',
    });

    expect(resolveSurfaceModel(registry, {
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

describe('checkSurfaceLlmEndpoint', () => {
  it('returns ok when the configured model id is listed by the server', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      Response.json({ data: [{ id: 'gemma-4-12b-qat' }] });

    await expect(checkSurfaceLlmEndpoint(surfaceLlmConfig)).resolves.toEqual({
      ok: true,
    });

    globalThis.fetch = originalFetch;
  });

  it('returns a message when the model id is not listed', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      Response.json({ data: [{ id: 'gemma-4-12b-qat' }] });

    await expect(
      checkSurfaceLlmEndpoint({ ...surfaceLlmConfig, modelId: 'local' }),
    ).resolves.toEqual({
      ok: false,
      message: expect.stringMatching(/SURFACE_LLM_MODEL_ID "local"/),
    });

    globalThis.fetch = originalFetch;
  });

  it('returns a message on network failure', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('connection refused');
    };

    await expect(checkSurfaceLlmEndpoint(surfaceLlmConfig)).resolves.toEqual({
      ok: false,
      message: expect.stringMatching(/Cannot reach surface LLM/),
    });

    globalThis.fetch = originalFetch;
  });
});

describe('warnSurfaceLlmEndpoint', () => {
  it('logs a warning and does not throw when the endpoint check fails', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('connection refused');
    };

    const warnings: Array<{ obj: object; msg: string | undefined }> = [];
    const log = {
      warn(obj: object, msg?: string) {
        warnings.push({ obj, msg: msg ?? undefined });
      },
    } as Pick<AppLogger, 'warn'>;

    await expect(
      warnSurfaceLlmEndpoint(surfaceLlmConfig, log),
    ).resolves.toBeUndefined();

    expect(warnings).toEqual([
      {
        obj: { event: 'surface.llm.endpoint_warning' },
        msg: expect.stringMatching(/Cannot reach surface LLM/),
      },
    ]);

    globalThis.fetch = originalFetch;
  });
});

describe('validateSurfaceLlmEndpoint', () => {
  it('accepts a configured model id returned by the server', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      Response.json({ data: [{ id: 'gemma-4-12b-qat' }] });

    await expect(
      validateSurfaceLlmEndpoint(surfaceLlmConfig),
    ).resolves.toBeUndefined();

    globalThis.fetch = originalFetch;
  });

  it('rejects unknown model ids with available models listed', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      Response.json({ data: [{ id: 'gemma-4-12b-qat' }] });

    await expect(
      validateSurfaceLlmEndpoint({ ...surfaceLlmConfig, modelId: 'local' }),
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
