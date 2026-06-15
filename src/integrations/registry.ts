import type { AgentLlmRole } from '../config/agentLlm.js';
import { ALL_BASE_TOOL_NAMES } from './baseTools.js';
import type { IntegrationDefinition } from './types.js';
import { getIntegrationToolsForRole } from './types.js';
import { webSearchIntegration } from './webSearch/index.js';

const DEFINITIONS = [webSearchIntegration] as const;

const integrationMap = new Map<string, IntegrationDefinition>(
  DEFINITIONS.map((definition) => [definition.id, definition]),
);

/** Returns a registered integration definition by id, if present. */
export function getIntegration(id: string): IntegrationDefinition | undefined {
  return integrationMap.get(id);
}

/** Returns all registered integration definitions. */
export function listIntegrations(): readonly IntegrationDefinition[] {
  return DEFINITIONS;
}

/** Throws when integration tool names collide with base tools or each other. */
export function validateRegistry(): void {
  const baseToolNames = new Set<string>(ALL_BASE_TOOL_NAMES);
  const toolOwners = new Map<string, string>();

  for (const definition of DEFINITIONS) {
    const namesInDefinition = new Set<string>();

    for (const role of ['surface', 'worker'] as AgentLlmRole[]) {
      for (const spec of getIntegrationToolsForRole(definition, role)) {
        if (baseToolNames.has(spec.name)) {
          throw new Error(
            `Integration tool "${spec.name}" (${definition.id}, ${role}) collides with a base tool name`,
          );
        }

        if (namesInDefinition.has(spec.name)) {
          continue;
        }

        const existingOwner = toolOwners.get(spec.name);
        if (existingOwner !== undefined && existingOwner !== definition.id) {
          throw new Error(
            `Integration tool "${spec.name}" is declared by both "${existingOwner}" and "${definition.id}"`,
          );
        }

        namesInDefinition.add(spec.name);
        toolOwners.set(spec.name, definition.id);
      }
    }
  }
}

/** Collects process-scoped shutdown hooks from all registered integrations. */
export function collectProcessShutdownHooks(): Array<() => Promise<void> | void> {
  const hooks: Array<() => Promise<void> | void> = [];
  for (const definition of DEFINITIONS) {
    if (definition.onProcessShutdown !== undefined) {
      hooks.push(definition.onProcessShutdown);
    }
  }
  return hooks;
}
