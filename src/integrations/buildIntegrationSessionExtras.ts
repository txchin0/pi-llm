import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

import type { AgentLlmRole } from '../config/agentLlm.js';
import type { AppLogger } from '../logging/types.js';
import type { OAuthService } from './oauth/oauthService.js';
import type { EnabledIntegration, IntegrationContext } from './types.js';
import { getIntegrationToolsForRole } from './types.js';

export type BuildIntegrationSessionExtrasInput = {
  userId: string;
  log?: AppLogger;
  oauthService: OAuthService;
};

export type IntegrationSessionExtras = {
  toolNames: string[];
  extensionFactory: ExtensionFactory;
  promptFragments: string[];
  /** Worker capability sentences, collected for both roles (the worker ignores them). */
  workerCapabilities: string[];
};

/** Builds allowlist names, extension factory, and prompt fragments for one agent role. */
export function buildIntegrationSessionExtras(
  enabled: EnabledIntegration[],
  role: AgentLlmRole,
  input: BuildIntegrationSessionExtrasInput,
): IntegrationSessionExtras {
  const toolNames: string[] = [];
  const promptFragments: string[] = [];
  const workerCapabilities: string[] = [];

  for (const { definition } of enabled) {
    const specs = getIntegrationToolsForRole(definition, role);
    for (const spec of specs) {
      toolNames.push(spec.name);
    }

    const prompt = definition.systemPrompt?.[role];
    if (prompt !== undefined && prompt.trim().length > 0) {
      promptFragments.push(prompt);
    }

    const capability = definition.workerCapability;
    if (capability !== undefined && capability.trim().length > 0) {
      workerCapabilities.push(capability.trim());
    }
  }

  const extensionFactory: ExtensionFactory = (pi) => {
    const registeredNames = new Set<string>();

    for (const { definition, config } of enabled) {
      const integrationCtx: IntegrationContext = {
        userId: input.userId,
        role,
        config,
        ...(input.log !== undefined ? { log: input.log } : {}),
      };

      if (definition.oauth !== undefined) {
        const oauth = definition.oauth;
        integrationCtx.getAccessToken = () =>
          input.oauthService.getAccessToken(
            input.userId,
            oauth.providerId,
            oauth.scopes[role] ?? [],
          );
      }

      const specs = getIntegrationToolsForRole(definition, role);
      for (const spec of specs) {
        spec.register(pi, integrationCtx);
        registeredNames.add(spec.name);
      }

      if (definition.onSessionShutdown !== undefined) {
        const onShutdown = definition.onSessionShutdown;
        pi.on('session_shutdown', async () => {
          await onShutdown();
        });
      }
    }

    assertRegisteredToolsMatchAllowlist(toolNames, registeredNames);
  };

  return { toolNames, extensionFactory, promptFragments, workerCapabilities };
}

/** Ensures the extension factory registered every tool name in the allowlist. */
function assertRegisteredToolsMatchAllowlist(
  allowlistNames: readonly string[],
  registeredNames: ReadonlySet<string>,
): void {
  for (const name of allowlistNames) {
    if (!registeredNames.has(name)) {
      throw new Error(`Integration tool "${name}" is allowlisted but was not registered`);
    }
  }
}
