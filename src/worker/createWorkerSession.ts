import type { AgentSession, AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';

import { buildRoleAgentSession } from '../agent/buildRoleAgentSession.js';
import type {
  WorkerAgentConfig,
  WorkerModel,
} from '../config/workerAgent.js';
import { WORKER_BASE_TOOLS } from '../integrations/baseTools.js';
import type { OAuthService } from '../integrations/oauth/oauthService.js';
import type { EnabledIntegration } from '../integrations/types.js';
import type { AppLogger } from '../logging/types.js';
import { buildWorkerSystemPrompt } from './buildWorkerSystemPrompt.js';
import { createWorkerExtension } from './extensions/workerExtension.js';

export type CreateWorkerSessionOptions = {
  userId: string;
  userMemoryWorkspace: string;
  dataRoot: string;
  model: WorkerModel;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  workerAgentConfig: WorkerAgentConfig;
  enabledIntegrations: EnabledIntegration[];
  oauthService?: OAuthService;
  log?: AppLogger;
};

/**
 * Creates a write-capable Pi worker session for one background task.
 *
 * Pi-internal retry is disabled because the task queue owns retry policy.
 */
export async function createWorkerSession(
  options: CreateWorkerSessionOptions,
): Promise<AgentSession> {
  return buildRoleAgentSession({
    userId: options.userId,
    userMemoryWorkspace: options.userMemoryWorkspace,
    dataRoot: options.dataRoot,
    model: options.model,
    authStorage: options.authStorage,
    modelRegistry: options.modelRegistry,
    thinkingLevel: options.workerAgentConfig.thinkingLevel,
    role: 'worker',
    enabledIntegrations: options.enabledIntegrations,
    ...(options.oauthService !== undefined ? { oauthService: options.oauthService } : {}),
    ...(options.log !== undefined ? { log: options.log } : {}),
    spec: {
      baseTools: WORKER_BASE_TOOLS,
      buildSystemPrompt: buildWorkerSystemPrompt,
      settings: {
        compaction: { enabled: false },
        retry: { enabled: false },
      },
      roleExtensionFactories: [createWorkerExtension],
      extensionLoadError: {
        event: 'worker.extension.load_error',
        message: 'worker extension failed to load',
      },
    },
  });
}
