export {
  loadSurfaceAgentConfig,
  resolveSurfaceThinkingLevel,
  surfaceAgentConfig,
  type SurfaceAgentConfig,
  type SurfacePiThinkingLevel,
  type SurfaceThinkingLevel,
} from './surfaceAgentConfig.js';

import type { AppLogger } from '../logging/types.js';
import {
  buildAgentModelRegistration,
  checkAgentLlmEndpoint,
  createAgentAuthStorage,
  createAgentLlmRuntime,
  createAgentModelRegistry,
  resolveAgentModel,
  resolveUserMemoryWorkspace,
  validateAgentLlmEndpoint,
  warnAgentLlmEndpoint,
  type AgentLlmEndpointCheckResult,
  type AgentLlmRuntime,
  type AgentModel,
} from './agentLlm.js';
import {
  surfaceAgentConfig,
  type SurfaceAgentConfig,
} from './surfaceAgentConfig.js';

export type SurfaceModel = AgentModel;
export type SurfaceLlmEndpointCheckResult = AgentLlmEndpointCheckResult;

export { resolveUserMemoryWorkspace };

/** Creates auth storage with a runtime API key for the surface provider. */
export function createSurfaceAuthStorage(
  config: SurfaceAgentConfig = surfaceAgentConfig,
) {
  return createAgentAuthStorage(config);
}

/** Builds the Pi model entry for the surface llama.cpp-compatible server. */
export function buildSurfaceModelRegistration(
  config: Pick<SurfaceAgentConfig, 'modelId' | 'contextWindow' | 'maxTokens'>,
) {
  return buildAgentModelRegistration(config, 'surface');
}

/** Registers the surface llama.cpp-compatible provider and returns the registry. */
export function createSurfaceModelRegistry(
  authStorage: ReturnType<typeof createSurfaceAuthStorage>,
  config: SurfaceAgentConfig = surfaceAgentConfig,
) {
  return createAgentModelRegistry(authStorage, config, 'surface');
}

/** Checks whether the configured surface model exists on the LLM server. */
export function checkSurfaceLlmEndpoint(
  config: SurfaceAgentConfig = surfaceAgentConfig,
): Promise<SurfaceLlmEndpointCheckResult> {
  return checkAgentLlmEndpoint(config, 'surface');
}

/** Logs a warning when the surface LLM endpoint check fails. */
export function warnSurfaceLlmEndpoint(
  config: SurfaceAgentConfig = surfaceAgentConfig,
  log?: Pick<AppLogger, 'warn'>,
): Promise<void> {
  return warnAgentLlmEndpoint(config, 'surface', log);
}

/** Confirms the configured surface model exists on the LLM server. */
export function validateSurfaceLlmEndpoint(
  config: SurfaceAgentConfig = surfaceAgentConfig,
): Promise<void> {
  return validateAgentLlmEndpoint(config, 'surface');
}

/** Resolves the configured surface model from the registry. */
export function resolveSurfaceModel(
  modelRegistry: ReturnType<typeof createSurfaceModelRegistry>,
  config: SurfaceAgentConfig = surfaceAgentConfig,
): SurfaceModel {
  return resolveAgentModel(modelRegistry, config);
}

/** Builds the full surface LLM runtime (auth, registry, model, endpoint helpers). */
export function createSurfaceLlmRuntime(
  config: SurfaceAgentConfig = surfaceAgentConfig,
): AgentLlmRuntime {
  return createAgentLlmRuntime(config, { role: 'surface' });
}
