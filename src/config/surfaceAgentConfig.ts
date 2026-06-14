import {
  loadAgentLlmConfig,
  resolveAgentThinkingLevel,
  type AgentLlmConfig,
  type AgentPiThinkingLevel,
  type AgentThinkingLevel,
} from './agentLlm.js';

export type SurfacePiThinkingLevel = AgentPiThinkingLevel;
export type SurfaceThinkingLevel = AgentThinkingLevel;
export type SurfaceAgentConfig = AgentLlmConfig;

/** Loads surface agent configuration from the environment. */
export function loadSurfaceAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
): SurfaceAgentConfig {
  return loadAgentLlmConfig(
    {
      prefix: 'SURFACE',
      defaults: {
        thinkingEnabled: false,
        thinkingLevel: 'low',
      },
    },
    env,
  );
}

export const surfaceAgentConfig = loadSurfaceAgentConfig();

export { resolveAgentThinkingLevel as resolveSurfaceThinkingLevel };
