import {
  loadRoleAgentConfig,
  type AgentLlmConfig,
} from '../../../src/config/agentLlm.js';

export type E2eJudgeMode = 'warn' | 'off';

export type E2eJudgeConfig = {
  mode: E2eJudgeMode;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  /** When set, scenarios fail if their judge score falls below this (0-100). */
  threshold?: number;
};

export type E2eRuntimeConfig = {
  surface: AgentLlmConfig;
  worker: AgentLlmConfig;
  judge: E2eJudgeConfig;
  trials: number;
  workerTaskTimeoutMs: number;
};

/** Returns a trimmed env value, or undefined when unset or blank. */
function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/** Applies `E2E_LLM_*` overrides onto both role env prefixes. */
function overlayRoleEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...env };
  const baseUrl = readEnv(env, 'E2E_LLM_BASE_URL');
  const modelId = readEnv(env, 'E2E_LLM_MODEL_ID');

  for (const prefix of ['SURFACE', 'WORKER'] as const) {
    if (baseUrl !== undefined) {
      merged[`${prefix}_LLM_BASE_URL`] = baseUrl;
    }
    if (modelId !== undefined) {
      merged[`${prefix}_LLM_MODEL_ID`] = modelId;
    }
  }

  return merged;
}

/** Returns the single model id served at `baseUrl`, or undefined. */
async function detectSingleModelId(
  baseUrl: string,
  apiKey: string,
): Promise<string | undefined> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      return undefined;
    }

    const body = (await response.json()) as { data?: Array<{ id?: string }> };
    const ids = (body.data ?? [])
      .map((entry) => entry.id?.trim())
      .filter((id): id is string => Boolean(id));
    return ids.length === 1 ? ids[0] : undefined;
  } catch {
    return undefined;
  }
}

/** Parses an integer env knob with a default, rejecting non-positive values. */
function parsePositiveIntKnob(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = readEnv(env, name);
  if (raw === undefined) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${name} value: ${raw}. Expected a positive integer.`);
  }

  return value;
}

/** Parses the E2E_JUDGE mode, defaulting to `warn`. */
function parseJudgeMode(env: NodeJS.ProcessEnv): E2eJudgeMode {
  const raw = readEnv(env, 'E2E_JUDGE') ?? 'warn';
  if (raw !== 'warn' && raw !== 'off') {
    throw new Error(`Invalid E2E_JUDGE value: ${raw}. Expected "warn" or "off".`);
  }

  return raw;
}

/** Parses the optional judge score threshold (0-100). */
function parseJudgeThreshold(env: NodeJS.ProcessEnv): number | undefined {
  const raw = readEnv(env, 'E2E_JUDGE_THRESHOLD');
  if (raw === undefined) {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(
      `Invalid E2E_JUDGE_THRESHOLD value: ${raw}. Expected a number between 0 and 100.`,
    );
  }

  return value;
}

/**
 * Resolves the surface/worker LLM configs plus e2e knobs from the environment.
 *
 * `E2E_LLM_BASE_URL` / `E2E_LLM_MODEL_ID` override both roles so a single
 * variable switches the whole suite to a different model for comparison runs.
 * When no model id is configured anywhere, the single model reported by the
 * server's `/models` endpoint is adopted so the suite works out of the box.
 */
export async function resolveE2eRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<E2eRuntimeConfig> {
  const merged = overlayRoleEnv(env);

  for (const prefix of ['SURFACE', 'WORKER'] as const) {
    if (readEnv(merged, `${prefix}_LLM_MODEL_ID`) !== undefined) {
      continue;
    }

    const baseUrl =
      readEnv(merged, `${prefix}_LLM_BASE_URL`) ?? 'http://127.0.0.1:8080/v1';
    const apiKey = readEnv(merged, `${prefix}_LLM_API_KEY`) ?? 'local';
    const detected = await detectSingleModelId(baseUrl, apiKey);
    if (detected !== undefined) {
      merged[`${prefix}_LLM_MODEL_ID`] = detected;
    }
  }

  const surface = loadRoleAgentConfig('surface', merged);
  const worker = loadRoleAgentConfig('worker', merged);
  const threshold = parseJudgeThreshold(merged);

  return {
    surface,
    worker,
    judge: {
      mode: parseJudgeMode(merged),
      baseUrl: readEnv(merged, 'E2E_JUDGE_BASE_URL') ?? surface.baseUrl,
      modelId: readEnv(merged, 'E2E_JUDGE_MODEL_ID') ?? surface.modelId,
      apiKey: surface.apiKey,
      ...(threshold !== undefined ? { threshold } : {}),
    },
    trials: parsePositiveIntKnob(merged, 'E2E_TRIALS', 1),
    workerTaskTimeoutMs: parsePositiveIntKnob(
      merged,
      'E2E_WORKER_TASK_TIMEOUT_MS',
      120_000,
    ),
  };
}
