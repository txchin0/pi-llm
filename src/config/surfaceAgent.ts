import path from 'node:path';

import {
  AuthStorage,
  ModelRegistry,
} from '@earendil-works/pi-coding-agent';

import type { AppLogger } from '../logging/types.js';

export type SurfacePiThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

export type SurfaceModel = NonNullable<ReturnType<ModelRegistry['find']>>;

const SURFACE_THINKING_LEVELS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;

export type SurfaceThinkingLevel = (typeof SURFACE_THINKING_LEVELS)[number];

export type SurfaceAgentConfig = {
  baseUrl: string;
  modelId: string;
  apiKey: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  thinkingEnabled: boolean;
  thinkingLevel: SurfacePiThinkingLevel;
};

/** Parses a positive integer env value or throws. */
function parsePositiveInt(
  value: string | undefined,
  name: string,
  defaultValue: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }

  return parsed;
}

/** Parses a boolean env flag (`true`/`1`/`false`/`0`). */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  if (value === 'true' || value === '1') {
    return true;
  }

  if (value === 'false' || value === '0') {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}. Expected true or false.`);
}

/** Validates an OpenAI-compatible base URL ending with `/v1`. */
function parseBaseUrl(value: string | undefined): string {
  const baseUrl = (value ?? 'http://127.0.0.1:8080/v1').trim();

  try {
    const parsed = new URL(baseUrl);
    if (!parsed.pathname.endsWith('/v1')) {
      throw new Error('pathname must end with /v1');
    }
  } catch {
    throw new Error(
      `Invalid SURFACE_LLM_BASE_URL value: ${baseUrl}. Expected an absolute URL ending with /v1.`,
    );
  }

  return baseUrl;
}

/** Parses a non-empty trimmed string or returns the default. */
function parseString(value: string | undefined, defaultValue: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : defaultValue;
}

/** Parses `SURFACE_THINKING_LEVEL` when thinking is enabled. */
function parseSurfaceThinkingLevel(
  value: string | undefined,
): SurfaceThinkingLevel {
  const level = (value ?? 'low').trim() as SurfaceThinkingLevel;
  if (!(SURFACE_THINKING_LEVELS as readonly string[]).includes(level)) {
    throw new Error(
      `Invalid SURFACE_THINKING_LEVEL value: ${value}. Expected one of ${SURFACE_THINKING_LEVELS.join(', ')}.`,
    );
  }

  return level;
}

/** Resolves Pi thinking level from surface thinking env flags. */
export function resolveSurfaceThinkingLevel(
  thinkingEnabled: boolean,
  thinkingLevel: SurfaceThinkingLevel,
): SurfacePiThinkingLevel {
  if (!thinkingEnabled) {
    return 'off';
  }

  return thinkingLevel;
}

/** Loads surface agent configuration from the environment. */
export function loadSurfaceAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
): SurfaceAgentConfig {
  const thinkingEnabled = parseBoolean(env.SURFACE_THINKING_ENABLED, false);
  const surfaceThinkingLevel = thinkingEnabled
    ? parseSurfaceThinkingLevel(env.SURFACE_THINKING_LEVEL)
    : 'low';

  return {
    baseUrl: parseBaseUrl(env.SURFACE_LLM_BASE_URL),
    modelId: parseString(env.SURFACE_LLM_MODEL_ID, 'local'),
    apiKey: parseString(env.SURFACE_LLM_API_KEY, 'local'),
    provider: parseString(env.SURFACE_LLM_PROVIDER, 'llamacpp'),
    contextWindow: parsePositiveInt(
      env.SURFACE_LLM_CONTEXT_WINDOW,
      'SURFACE_LLM_CONTEXT_WINDOW',
      8192,
    ),
    maxTokens: parsePositiveInt(
      env.SURFACE_LLM_MAX_TOKENS,
      'SURFACE_LLM_MAX_TOKENS',
      2048,
    ),
    thinkingEnabled,
    thinkingLevel: resolveSurfaceThinkingLevel(
      thinkingEnabled,
      surfaceThinkingLevel,
    ),
  };
}

export const surfaceAgentConfig = loadSurfaceAgentConfig();

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
