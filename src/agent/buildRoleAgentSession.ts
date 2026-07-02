import type {
  AgentSession,
  AuthStorage,
  ExtensionFactory,
  ModelRegistry,
} from '@earendil-works/pi-coding-agent';
import {
  createAgentSession as createPiAgentSession,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

import type { AgentLlmRole, AgentModel, AgentPiThinkingLevel } from '../config/agentLlm.js';
import { assertToolAllowlistSync } from '../integrations/assertToolAllowlistSync.js';
import { buildIntegrationSessionExtras } from '../integrations/buildIntegrationSessionExtras.js';
import type { OAuthService } from '../integrations/oauth/oauthService.js';
import type { EnabledIntegration } from '../integrations/types.js';
import type { AppLogger } from '../logging/types.js';

import { createAgentResourceLoader } from './createAgentResourceLoader.js';
import { ensureUserWorkspace } from './ensureUserWorkspace.js';

export type AgentSessionRoleSpec = {
  baseTools: readonly string[];
  buildSystemPrompt: (promptFragments: string[]) => string;
  settings: {
    compaction: { enabled: false };
    retry: { enabled: boolean; maxRetries?: number };
  };
  roleExtensionFactories: ExtensionFactory[];
  extensionLoadError: { event: string; message: string };
};

/** Shared inputs for building a Pi agent session; `role` drives integrations, `spec` drives harness defaults. */
export type BuildRoleAgentSessionOptions = {
  userId: string;
  userMemoryWorkspace: string;
  dataRoot: string;
  model: AgentModel;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  thinkingLevel: AgentPiThinkingLevel;
  role: AgentLlmRole;
  enabledIntegrations: EnabledIntegration[];
  oauthService: OAuthService;
  log?: AppLogger;
  spec: AgentSessionRoleSpec;
};

/** Creates a Pi agent session from shared harness wiring and a role-specific spec. */
export async function buildRoleAgentSession(
  options: BuildRoleAgentSessionOptions,
): Promise<AgentSession> {
  const { spec } = options;

  await ensureUserWorkspace(options.userMemoryWorkspace);

  const settingsManager = SettingsManager.inMemory(spec.settings);

  const integrationExtras = buildIntegrationSessionExtras(
    options.enabledIntegrations,
    options.role,
    {
      userId: options.userId,
      oauthService: options.oauthService,
      ...(options.log !== undefined ? { log: options.log } : {}),
    },
  );
  assertToolAllowlistSync(spec.baseTools, integrationExtras.toolNames);

  const resourceLoader = await createAgentResourceLoader({
    cwd: options.userMemoryWorkspace,
    dataRoot: options.dataRoot,
    systemPrompt: spec.buildSystemPrompt(integrationExtras.promptFragments),
    settingsManager,
    extensionFactories: [
      ...spec.roleExtensionFactories,
      integrationExtras.extensionFactory,
    ],
  });

  const { session, extensionsResult } = await createPiAgentSession({
    cwd: options.userMemoryWorkspace,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    tools: [...spec.baseTools, ...integrationExtras.toolNames],
    authStorage: options.authStorage,
    modelRegistry: options.modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(options.userMemoryWorkspace),
    settingsManager,
  });

  for (const { path, error } of extensionsResult.errors) {
    options.log?.warn(
      { event: spec.extensionLoadError.event, path, error },
      spec.extensionLoadError.message,
    );
  }

  return session;
}
