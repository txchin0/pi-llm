import path from 'node:path';

import {
  AuthStorage,
  ModelRegistry,
} from '@earendil-works/pi-coding-agent';

import type { AppLogger } from '../logging/types.js';
import {
  surfaceAgentConfig,
  type SurfaceAgentConfig,
} from './surfaceAgentConfig.js';

export type SurfaceModel = NonNullable<ReturnType<ModelRegistry['find']>>;

/** Creates auth storage with a runtime API key for the surface provider. */
export function createSurfaceAuthStorage(
  config: SurfaceAgentConfig = surfaceAgentConfig,
): AuthStorage {
  const authStorage = AuthStorage.create();
  authStorage.setRuntimeApiKey(config.provider, config.apiKey);
  return authStorage;
}

type SurfaceModelRegistration = {
  id: string;
  name: string;
  reasoning: boolean;
  input: ['text'];
  cost: { input: 0; output: 0; cacheRead: 0; cacheWrite: 0 };
  contextWindow: number;
  maxTokens: number;
  compat: {
    supportsDeveloperRole: false;
    supportsReasoningEffort: true;
    thinkingFormat: 'qwen-chat-template';
  };
};

/**
 * Builds the Pi model entry for a llama.cpp OpenAI-compatible server.
 *
 * `reasoning` stays true so Pi can emit llama.cpp's per-request
 * `chat_template_kwargs.enable_thinking` toggle. Session `thinkingLevel`
 * still controls whether thinking is on (`true`) or off (`false`).
 */
export function buildSurfaceModelRegistration(
  config: Pick<SurfaceAgentConfig, 'modelId' | 'contextWindow' | 'maxTokens'>,
): SurfaceModelRegistration {
  return {
    id: config.modelId,
    name: `${config.modelId} (surface)`,
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      thinkingFormat: 'qwen-chat-template',
    },
  };
}

/** Registers the surface llama.cpp-compatible provider and returns the registry. */
export function createSurfaceModelRegistry(
  authStorage: AuthStorage,
  config: SurfaceAgentConfig = surfaceAgentConfig,
): ModelRegistry {
  const modelRegistry = ModelRegistry.inMemory(authStorage);

  modelRegistry.registerProvider(config.provider, {
    baseUrl: config.baseUrl,
    api: 'openai-completions',
    apiKey: config.apiKey,
    models: [buildSurfaceModelRegistration(config)],
  });

  return modelRegistry;
}

type OpenAiModelsResponse = {
  data?: Array<{ id?: string }>;
};

export type SurfaceLlmEndpointCheckResult =
  | { ok: true }
  | { ok: false; message: string };

/** Checks whether the configured model exists on the OpenAI-compatible LLM server. */
export async function checkSurfaceLlmEndpoint(
  config: SurfaceAgentConfig = surfaceAgentConfig,
): Promise<SurfaceLlmEndpointCheckResult> {
  const modelsUrl = `${config.baseUrl.replace(/\/$/, '')}/models`;

  let response: Response;
  try {
    response = await fetch(modelsUrl, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'network error';
    return {
      ok: false,
      message: `Cannot reach surface LLM at ${config.baseUrl}: ${detail}. Is llama-server running?`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      message: `Surface LLM at ${config.baseUrl} returned HTTP ${response.status} for GET /models.`,
    };
  }

  const body = (await response.json()) as OpenAiModelsResponse;
  const availableModelIds = (body.data ?? [])
    .map((entry) => entry.id?.trim())
    .filter((id): id is string => Boolean(id));

  if (!availableModelIds.includes(config.modelId)) {
    const available =
      availableModelIds.length > 0
        ? availableModelIds.join(', ')
        : '(none reported)';

    return {
      ok: false,
      message: `SURFACE_LLM_MODEL_ID "${config.modelId}" was not found at ${config.baseUrl}. Available models: ${available}.`,
    };
  }

  return { ok: true };
}

/** Logs a warning when the surface LLM endpoint check fails. */
export async function warnSurfaceLlmEndpoint(
  config: SurfaceAgentConfig = surfaceAgentConfig,
  log?: Pick<AppLogger, 'warn'>,
): Promise<void> {
  const result = await checkSurfaceLlmEndpoint(config);
  if (!result.ok) {
    log?.warn({ event: 'surface.llm.endpoint_warning' }, result.message);
  }
}

/** Confirms the configured model exists on the OpenAI-compatible LLM server. */
export async function validateSurfaceLlmEndpoint(
  config: SurfaceAgentConfig = surfaceAgentConfig,
): Promise<void> {
  const result = await checkSurfaceLlmEndpoint(config);
  if (!result.ok) {
    throw new Error(result.message);
  }
}

/** Resolves the configured surface model from the registry. */
export function resolveSurfaceModel(
  modelRegistry: ModelRegistry,
  config: SurfaceAgentConfig = surfaceAgentConfig,
): SurfaceModel {
  const model = modelRegistry.find(config.provider, config.modelId);
  if (!model) {
    throw new Error(
      `Surface model not found: ${config.provider}/${config.modelId}`,
    );
  }

  return model;
}

/** Returns the per-user memory workspace path under `DATA_ROOT`. */
export function resolveUserMemoryWorkspace(
  dataRoot: string,
  userId: string,
): string {
  return path.resolve(dataRoot, 'users', userId, 'memory');
}
