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

  const resourceLoader = await createSurfaceResourceLoader({
    cwd: options.userMemoryWorkspace,
    dataRoot: options.dataRoot,
    systemPrompt: buildWorkerSystemPrompt(),
    settingsManager,
    extensionFactories: [createWorkerExtension],
  });

  const { session, extensionsResult } = await createAgentSession({
    cwd: options.userMemoryWorkspace,
    model: options.model,
    thinkingLevel: options.workerAgentConfig.thinkingLevel,
    tools: ['read', 'write', 'edit', 'ls', 'grep', 'find', 'web_search'],
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
