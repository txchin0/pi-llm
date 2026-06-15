import { closeExaMcp } from './exaMcpClient.js';
import type { IntegrationContext, IntegrationDefinition, IntegrationToolSpec } from '../types.js';
import { registerWebSearchTool, type WebSearchConfig } from './webSearchTool.js';

const webSearchToolSpec: IntegrationToolSpec = {
  name: 'web_search',
  register(pi, ctx) {
    registerWebSearchTool(pi, ctx as IntegrationContext<WebSearchConfig>);
  },
};

/** Parses optional per-user Exa API key from stored integration config. */
function parseWebSearchConfig(raw: Record<string, unknown>): WebSearchConfig {
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : undefined;
  return apiKey ? { apiKey } : {};
}

/** Reference integration: Exa-backed web search on surface and worker. */
export const webSearchIntegration: IntegrationDefinition = {
  id: 'web_search',
  label: 'Web Search',
  defaultEnabled: true,
  tools: {
    surface: [webSearchToolSpec],
    worker: [webSearchToolSpec],
  },
  parseConfig: parseWebSearchConfig,
  onProcessShutdown: closeExaMcp,
};
