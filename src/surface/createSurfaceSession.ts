import type {
  AgentSession,
  AuthStorage,
  ModelRegistry,
} from '@earendil-works/pi-coding-agent';

import { buildRoleAgentSession } from '../agent/buildRoleAgentSession.js';
import { validateAgentLlmEndpoint } from '../config/agentLlm.js';
import type {
  SurfaceAgentConfig,
  SurfaceModel,
} from '../config/surfaceAgent.js';
import type { SessionId } from '../contracts/respond.js';
import { SURFACE_BASE_TOOLS } from '../integrations/baseTools.js';
import type { OAuthService } from '../integrations/oauth/oauthService.js';
import type { EnabledIntegration } from '../integrations/types.js';
import type { AppLogger } from '../logging/types.js';
import type { TaskQueue } from '../queue/taskQueue.js';

import { buildSurfaceSystemPrompt } from './buildSurfaceSystemPrompt.js';
import {
  createSurfaceExtensionFactory,
  type SurfaceExtensionDependencies,
} from './extensions/surfaceExtension.js';

export type CreateSurfaceSessionOptions = {
  userId: string;
  sessionId: SessionId;
  userMemoryWorkspace: string;
  dataRoot: string;
  model: SurfaceModel;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  surfaceAgentConfig: SurfaceAgentConfig;
  taskQueue: TaskQueue;
  contextTurnLimit: number;
  enabledIntegrations: EnabledIntegration[];
  oauthService?: OAuthService;
  log?: AppLogger;
};

/** Builds extension dependencies without passing an undefined optional logger. */
function buildSurfaceExtensionDependencies(
  options: CreateSurfaceSessionOptions,
): SurfaceExtensionDependencies {
  const deps: SurfaceExtensionDependencies = {
    taskQueue: options.taskQueue,
    userId: options.userId,
    sessionId: options.sessionId,
    contextTurnLimit: options.contextTurnLimit,
  };

  if (options.log !== undefined) {
    deps.log = options.log;
  }

  return deps;
}

/**
 * Creates a read-only Pi surface agent session for one conversation thread.
 *
 * Per-session LLM endpoint validation is intentional: bootstrap warns at startup,
 * but this fails fast if the endpoint becomes unreachable before a new session opens.
 */
export async function createSurfaceSession(
  options: CreateSurfaceSessionOptions,
): Promise<AgentSession> {
  await validateAgentLlmEndpoint(options.surfaceAgentConfig, 'surface');

  return buildRoleAgentSession({
    userId: options.userId,
    userMemoryWorkspace: options.userMemoryWorkspace,
    dataRoot: options.dataRoot,
    model: options.model,
    authStorage: options.authStorage,
    modelRegistry: options.modelRegistry,
    thinkingLevel: options.surfaceAgentConfig.thinkingLevel,
    role: 'surface',
    enabledIntegrations: options.enabledIntegrations,
    ...(options.oauthService !== undefined ? { oauthService: options.oauthService } : {}),
    ...(options.log !== undefined ? { log: options.log } : {}),
    spec: {
      baseTools: SURFACE_BASE_TOOLS,
      buildSystemPrompt: buildSurfaceSystemPrompt,
      settings: {
        compaction: { enabled: false },
        retry: { enabled: true, maxRetries: 2 },
      },
      roleExtensionFactories: [
        createSurfaceExtensionFactory(buildSurfaceExtensionDependencies(options)),
      ],
      extensionLoadError: {
        event: 'surface.extension.load_error',
        message: 'surface extension failed to load',
      },
    },
  });
}
