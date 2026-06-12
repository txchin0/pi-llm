import { parseBoolean, parseNonEmptyString, parsePositiveInt } from './parseEnv.js';

export type SurfacePiThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

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
    modelId: parseNonEmptyString(env.SURFACE_LLM_MODEL_ID, 'local'),
    apiKey: parseNonEmptyString(env.SURFACE_LLM_API_KEY, 'local'),
    provider: parseNonEmptyString(env.SURFACE_LLM_PROVIDER, 'llamacpp'),
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
