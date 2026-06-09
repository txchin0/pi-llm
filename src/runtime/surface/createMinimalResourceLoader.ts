import { createExtensionRuntime } from '@earendil-works/pi-coding-agent';
import type { ResourceLoader } from '@earendil-works/pi-coding-agent';

/** Builds a ResourceLoader with no filesystem discovery for server embedding. */
export function createMinimalResourceLoader(
  systemPrompt: string,
): ResourceLoader {
  return {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}
