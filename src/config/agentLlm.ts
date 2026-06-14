import path from 'node:path';

import {
  AuthStorage,
  ModelRegistry,
} from '@earendil-works/pi-coding-agent';

import type { AppLogger } from '../logging/types.js';
import { parseBoolean, parseNonEmptyString, parsePositiveInt } from './parseEnv.js';

export type AgentLlmRole = 'surface' | 'worker';

export type AgentPiThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

const THINKING_LEVELS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;

export type AgentThinkingLevel = (typeof THINKING_LEVELS)[number];

export type AgentLlmConfig = {
  baseUrl: string;
  modelId: string;
  apiKey: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  thinkingEnabled: boolean;
  thinkingLevel: AgentPiThinkingLevel;
};

export type AgentLlmDefaults = {
  thinkingEnabled: boolean;
  thinkingLevel?: AgentThinkingLevel;
  baseUrl?: string;
  modelId?: string;
  apiKey?: string;
  provider?: string;
  contextWindow?: number;
  maxTokens?: number;
};

export type LoadAgentLlmConfigOptions = {
  prefix: 'SURFACE' | 'WORKER';
  defaults: AgentLlmDefaults;
};

export type AgentModel = NonNullable<ReturnType<ModelRegistry['find']>>;

export type AgentLlmRuntime = {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: AgentModel;
  checkEndpoint: () => Promise<AgentLlmEndpointCheckResult>;
  warnEndpoint: (log?: Pick<AppLogger, 'warn'>) => Promise<void>;
  validateEndpoint: () => Promise<void>;
};

export type AgentLlmEndpointCheckResult =
  | { ok: true }
  | { ok: false; message: string };

type OpenAiModelsResponse = {
  data?: Array<{ id?: string }>;
};

type AgentModelRegistration = {
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

/** Validates an OpenAI-compatible base URL ending with `/v1`. */
function parseBaseUrl(value: string | undefined, envName: string): string {
  const baseUrl = value?.trim();
  if (baseUrl === undefined || baseUrl === '') {
    throw new Error(`Missing ${envName}`);
  }

  try {
    const parsed = new URL(baseUrl);
    if (!parsed.pathname.endsWith('/v1')) {
      throw new Error('pathname must end with /v1');
    }
  } catch {
    throw new Error(
      `Invalid ${envName} value: ${baseUrl}. Expected an absolute URL ending with /v1.`,
    );
  }

  return baseUrl;
}

/** Parses a role-specific thinking level env var. */
function parseThinkingLevel(
  value: string | undefined,
  envName: string,
  fallback: AgentThinkingLevel,
): AgentThinkingLevel {
  const level = (value ?? fallback).trim() as AgentThinkingLevel;
  if (!(THINKING_LEVELS as readonly string[]).includes(level)) {
    throw new Error(
      `Invalid ${envName} value: ${value}. Expected one of ${THINKING_LEVELS.join(', ')}.`,
    );
  }

  return level;
}

/** Resolves Pi thinking level from thinking env flags. */
export function resolveAgentThinkingLevel(
  thinkingEnabled: boolean,
  thinkingLevel: AgentThinkingLevel,
): AgentPiThinkingLevel {
  if (!thinkingEnabled) {
    return 'off';
  }

  return thinkingLevel;
}

/** Loads agent LLM configuration from prefixed environment variables. */
export function loadAgentLlmConfig(
  options: LoadAgentLlmConfigOptions,
  env: NodeJS.ProcessEnv = process.env,
): AgentLlmConfig {
  const { prefix, defaults } = options;
  const thinkingEnabled = parseBoolean(
    env[`${prefix}_THINKING_ENABLED`],
    defaults.thinkingEnabled,
  );
  const thinkingLevel = thinkingEnabled
    ? parseThinkingLevel(
        env[`${prefix}_THINKING_LEVEL`],
        `${prefix}_THINKING_LEVEL`,
        defaults.thinkingLevel ?? 'low',
      )
    : (defaults.thinkingLevel ?? 'low');

  const baseUrlDefault = defaults.baseUrl ?? 'http://127.0.0.1:8080/v1';
  const baseUrlRaw = env[`${prefix}_LLM_BASE_URL`];
  const baseUrl =
    baseUrlRaw === undefined || baseUrlRaw.trim() === ''
      ? baseUrlDefault
      : parseBaseUrl(baseUrlRaw, `${prefix}_LLM_BASE_URL`);

  return {
    baseUrl,
    modelId: parseNonEmptyString(
      env[`${prefix}_LLM_MODEL_ID`],
      defaults.modelId ?? 'local',
    ),
    apiKey: parseNonEmptyString(
      env[`${prefix}_LLM_API_KEY`],
      defaults.apiKey ?? 'local',
    ),
    provider: parseNonEmptyString(
      env[`${prefix}_LLM_PROVIDER`],
      defaults.provider ?? 'llamacpp',
    ),
    contextWindow: parsePositiveInt(
      env[`${prefix}_LLM_CONTEXT_WINDOW`],
      `${prefix}_LLM_CONTEXT_WINDOW`,
      defaults.contextWindow ?? 8192,
    ),
    maxTokens: parsePositiveInt(
      env[`${prefix}_LLM_MAX_TOKENS`],
      `${prefix}_LLM_MAX_TOKENS`,
      defaults.maxTokens ?? 2048,
    ),
    thinkingEnabled,
    thinkingLevel: resolveAgentThinkingLevel(thinkingEnabled, thinkingLevel),
  };
}

/**
 * Builds the Pi model entry for a llama.cpp OpenAI-compatible server.
 *
 * `reasoning` stays true so Pi can emit llama.cpp's per-request
 * `chat_template_kwargs.enable_thinking` toggle.
 */
export function buildAgentModelRegistration(
  config: Pick<AgentLlmConfig, 'modelId' | 'contextWindow' | 'maxTokens'>,
  role: AgentLlmRole,
): AgentModelRegistration {
  return {
    id: config.modelId,
    name: `${config.modelId} (${role})`,
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

/** Creates auth storage with a runtime API key for the configured provider. */
export function createAgentAuthStorage(config: AgentLlmConfig): AuthStorage {
  const authStorage = AuthStorage.create();
  authStorage.setRuntimeApiKey(config.provider, config.apiKey);
  return authStorage;
}

/** Registers the llama.cpp-compatible provider and returns the registry. */
export function createAgentModelRegistry(
  authStorage: AuthStorage,
  config: AgentLlmConfig,
  role: AgentLlmRole,
): ModelRegistry {
  const modelRegistry = ModelRegistry.inMemory(authStorage);

  modelRegistry.registerProvider(config.provider, {
    baseUrl: config.baseUrl,
    api: 'openai-completions',
    apiKey: config.apiKey,
    models: [buildAgentModelRegistration(config, role)],
  });

  return modelRegistry;
}

/** Checks whether the configured model exists on the OpenAI-compatible LLM server. */
export async function checkAgentLlmEndpoint(
  config: AgentLlmConfig,
  role: AgentLlmRole,
): Promise<AgentLlmEndpointCheckResult> {
  const modelsUrl = `${config.baseUrl.replace(/\/$/, '')}/models`;
  const roleLabel = role === 'surface' ? 'Surface' : 'Worker';
  const modelEnvName =
    role === 'surface' ? 'SURFACE_LLM_MODEL_ID' : 'WORKER_LLM_MODEL_ID';

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
      message: `Cannot reach ${role} LLM at ${config.baseUrl}: ${detail}. Is llama-server running?`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      message: `${roleLabel} LLM at ${config.baseUrl} returned HTTP ${response.status} for GET /models.`,
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
      message: `${modelEnvName} "${config.modelId}" was not found at ${config.baseUrl}. Available models: ${available}.`,
    };
  }

  return { ok: true };
}

/** Logs a warning when the agent LLM endpoint check fails. */
export async function warnAgentLlmEndpoint(
  config: AgentLlmConfig,
  role: AgentLlmRole,
  log?: Pick<AppLogger, 'warn'>,
): Promise<void> {
  const result = await checkAgentLlmEndpoint(config, role);
  if (!result.ok) {
    log?.warn({ event: `${role}.llm.endpoint_warning` }, result.message);
  }
}

/** Confirms the configured model exists on the OpenAI-compatible LLM server. */
export async function validateAgentLlmEndpoint(
  config: AgentLlmConfig,
  role: AgentLlmRole,
): Promise<void> {
  const result = await checkAgentLlmEndpoint(config, role);
  if (!result.ok) {
    throw new Error(result.message);
  }
}

/** Resolves the configured agent model from the registry. */
export function resolveAgentModel(
  modelRegistry: ModelRegistry,
  config: AgentLlmConfig,
): AgentModel {
  const model = modelRegistry.find(config.provider, config.modelId);
  if (!model) {
    throw new Error(
      `Agent model not found: ${config.provider}/${config.modelId}`,
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

/** Builds auth storage, model registry, and endpoint helpers for one agent role. */
export function createAgentLlmRuntime(
  config: AgentLlmConfig,
  options: { role: AgentLlmRole },
): AgentLlmRuntime {
  const authStorage = createAgentAuthStorage(config);
  const modelRegistry = createAgentModelRegistry(
    authStorage,
    config,
    options.role,
  );
  const model = resolveAgentModel(modelRegistry, config);

  return {
    authStorage,
    modelRegistry,
    model,
    checkEndpoint: () => checkAgentLlmEndpoint(config, options.role),
    warnEndpoint: (log) => warnAgentLlmEndpoint(config, options.role, log),
    validateEndpoint: () => validateAgentLlmEndpoint(config, options.role),
  };
}
