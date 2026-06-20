export {
  loadWorkerAgentConfig,
  resolveWorkerThinkingLevel,
  workerAgentConfig,
  type WorkerAgentConfig,
  type WorkerPiThinkingLevel,
  type WorkerThinkingLevel,
} from './workerAgentConfig.js';

import {
  createAgentLlmRuntime,
  type AgentLlmRuntime,
  type AgentModel,
} from './agentLlm.js';
import {
  workerAgentConfig,
  type WorkerAgentConfig,
} from './workerAgentConfig.js';

export type WorkerModel = AgentModel;

/** Builds the full worker LLM runtime (auth, registry, model, endpoint helpers). */
export function createWorkerLlmRuntime(
  config: WorkerAgentConfig = workerAgentConfig,
): AgentLlmRuntime {
  return createAgentLlmRuntime(config, { role: 'worker' });
}
