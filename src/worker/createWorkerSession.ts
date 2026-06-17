import type { AuthStorage, ModelRegistry, AgentSession } from '@earendil-works/pi-coding-agent';
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

import type {
  WorkerAgentConfig,
  WorkerModel,
} from '../config/workerAgent.js';
import { assertToolAllowlistSync } from '../integrations/assertToolAllowlistSync.js';
import { WORKER_BASE_TOOLS } from '../integrations/baseTools.js';
import { buildIntegrationSessionExtras } from '../integrations/buildIntegrationSessionExtras.js';
import { noopOAuthService } from '../integrations/oauth/noopOAuthService.js';
import type { OAuthService } from '../integrations/oauth/oauthService.js';
import type { EnabledIntegration } from '../integrations/types.js';
import type { AppLogger } from '../logging/types.js';
import { buildWorkerSystemPrompt } from './buildWorkerSystemPrompt.js';
import { createWorkerExtension } from './extensions/workerExtension.js';
import { createSurfaceResourceLoader } from '../surface/createSurfaceResourceLoader.js';
import { ensureUserWorkspace } from '../surface/util/ensureUserWorkspace.js';

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
  await ensureUserWorkspace(options.userMemoryWorkspace);

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });

  const integrationExtras = buildIntegrationSessionExtras(
    options.enabledIntegrations,
    'worker',
    {
      userId: options.userId,
      oauthService: options.oauthService ?? noopOAuthService,
      ...(options.log !== undefined ? { log: options.log } : {}),
    },
  );
  assertToolAllowlistSync(WORKER_BASE_TOOLS, integrationExtras.toolNames);

  const resourceLoader = await createSurfaceResourceLoader({
    cwd: options.userMemoryWorkspace,
    dataRoot: options.dataRoot,
    systemPrompt: buildWorkerSystemPrompt(integrationExtras.promptFragments),
    settingsManager,
    extensionFactories: [createWorkerExtension, integrationExtras.extensionFactory],
  });

  const { session, extensionsResult } = await createAgentSession({
    cwd: options.userMemoryWorkspace,
    model: options.model,
    thinkingLevel: options.workerAgentConfig.thinkingLevel,
    tools: [...WORKER_BASE_TOOLS, ...integrationExtras.toolNames],
    authStorage: options.authStorage,
    modelRegistry: options.modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(options.userMemoryWorkspace),
    settingsManager,
  });

  for (const { path, error } of extensionsResult.errors) {
    options.log?.warn(
      { event: 'worker.extension.load_error', path, error },
      'worker extension failed to load',
    );
  }

  return session;
}
