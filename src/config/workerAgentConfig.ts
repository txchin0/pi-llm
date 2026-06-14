import {
  loadAgentLlmConfig,
  resolveAgentThinkingLevel,
  type AgentLlmConfig,
  type AgentPiThinkingLevel,
  type AgentThinkingLevel,
} from './agentLlm.js';

export type WorkerPiThinkingLevel = AgentPiThinkingLevel;
export type WorkerThinkingLevel = AgentThinkingLevel;
export type WorkerAgentConfig = AgentLlmConfig;

/** Loads worker agent configuration from the environment. */
export function loadWorkerAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkerAgentConfig {
  return loadAgentLlmConfig(
    {
      prefix: 'WORKER',
      defaults: {
        thinkingEnabled: true,
        thinkingLevel: 'low',
      },
    },
    env,
  );
}

export const workerAgentConfig = loadWorkerAgentConfig();

export { resolveAgentThinkingLevel as resolveWorkerThinkingLevel };
