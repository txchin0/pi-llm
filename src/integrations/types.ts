import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import type { AgentLlmRole } from '../config/agentLlm.js';
import type { AppLogger } from '../logging/types.js';

/** Runtime context passed to integration tool registration. */
export type IntegrationContext<TConfig = unknown> = {
  userId: string;
  role: AgentLlmRole;
  config: TConfig;
  log?: AppLogger;
};

/** One tool contributed by an integration for a given agent role. */
export type IntegrationToolSpec = {
  name: string;
  register(pi: ExtensionAPI, ctx: IntegrationContext): void;
};

/** Declares one optional per-user integration and its per-role contributions. */
export type IntegrationDefinition = {
  id: string;
  label: string;
  defaultEnabled: boolean;
  tools: Partial<Record<AgentLlmRole, IntegrationToolSpec[]>>;
  systemPrompt?: Partial<Record<AgentLlmRole, string>>;
  parseConfig?(raw: Record<string, unknown>): unknown;
  onSessionShutdown?: () => Promise<void> | void;
  onProcessShutdown?: () => Promise<void> | void;
};

/** A resolved, enabled integration with parsed config for session wiring. */
export type EnabledIntegration = {
  definition: IntegrationDefinition;
  config: unknown;
};

/** Returns tool specs for a role, defaulting to an empty list when absent. */
export function getIntegrationToolsForRole(
  definition: IntegrationDefinition,
  role: AgentLlmRole,
): IntegrationToolSpec[] {
  return definition.tools[role] ?? [];
}
