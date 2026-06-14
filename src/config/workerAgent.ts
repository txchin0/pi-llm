export {
  loadWorkerAgentConfig,
  resolveWorkerThinkingLevel,
  workerAgentConfig,
  type WorkerAgentConfig,
  type WorkerPiThinkingLevel,
  type WorkerThinkingLevel,
} from './workerAgentConfig.js';

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
  workerAgentConfig,
  type WorkerAgentConfig,
} from './workerAgentConfig.js';

export type WorkerModel = AgentModel;
export type WorkerLlmEndpointCheckResult = AgentLlmEndpointCheckResult;

export { resolveUserMemoryWorkspace };

/** Creates auth storage with a runtime API key for the worker provider. */
export function createWorkerAuthStorage(
  config: WorkerAgentConfig = workerAgentConfig,
) {
  return createAgentAuthStorage(config);
}

/** Builds the Pi model entry for the worker llama.cpp-compatible server. */
export function buildWorkerModelRegistration(
  config: Pick<WorkerAgentConfig, 'modelId' | 'contextWindow' | 'maxTokens'>,
) {
  return buildAgentModelRegistration(config, 'worker');
}

/** Registers the worker llama.cpp-compatible provider and returns the registry. */
export function createWorkerModelRegistry(
  authStorage: ReturnType<typeof createWorkerAuthStorage>,
  config: WorkerAgentConfig = workerAgentConfig,
) {
  return createAgentModelRegistry(authStorage, config, 'worker');
}

/** Checks whether the configured worker model exists on the LLM server. */
export function checkWorkerLlmEndpoint(
  config: WorkerAgentConfig = workerAgentConfig,
): Promise<WorkerLlmEndpointCheckResult> {
  return checkAgentLlmEndpoint(config, 'worker');
}

/** Logs a warning when the worker LLM endpoint check fails. */
export function warnWorkerLlmEndpoint(
  config: WorkerAgentConfig = workerAgentConfig,
  log?: Pick<AppLogger, 'warn'>,
): Promise<void> {
  return warnAgentLlmEndpoint(config, 'worker', log);
}

/** Confirms the configured worker model exists on the LLM server. */
export function validateWorkerLlmEndpoint(
  config: WorkerAgentConfig = workerAgentConfig,
): Promise<void> {
  return validateAgentLlmEndpoint(config, 'worker');
}

/** Resolves the configured worker model from the registry. */
export function resolveWorkerModel(
  modelRegistry: ReturnType<typeof createWorkerModelRegistry>,
  config: WorkerAgentConfig = workerAgentConfig,
): WorkerModel {
  return resolveAgentModel(modelRegistry, config);
}

/** Builds the full worker LLM runtime (auth, registry, model, endpoint helpers). */
export function createWorkerLlmRuntime(
  config: WorkerAgentConfig = workerAgentConfig,
): AgentLlmRuntime {
  return createAgentLlmRuntime(config, { role: 'worker' });
}
