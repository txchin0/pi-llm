export {
  loadSurfaceAgentConfig,
  resolveSurfaceThinkingLevel,
  surfaceAgentConfig,
  type SurfaceAgentConfig,
  type SurfacePiThinkingLevel,
  type SurfaceThinkingLevel,
} from './surfaceAgentConfig.js';

import {
  createAgentLlmRuntime,
  type AgentLlmRuntime,
  type AgentModel,
} from './agentLlm.js';
import {
  surfaceAgentConfig,
  type SurfaceAgentConfig,
} from './surfaceAgentConfig.js';

export type SurfaceModel = AgentModel;

/** Builds the full surface LLM runtime (auth, registry, model, endpoint helpers). */
export function createSurfaceLlmRuntime(
  config: SurfaceAgentConfig = surfaceAgentConfig,
): AgentLlmRuntime {
  return createAgentLlmRuntime(config, { role: 'surface' });
}
