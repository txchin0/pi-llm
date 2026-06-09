import type { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';

import type {
  SurfaceAgentConfig,
  SurfaceModel,
} from '../../config/surfaceAgent.js';
import {
  AgentSession,
  createAgentSession,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

import { buildSurfaceSystemPrompt } from './buildSurfaceSystemPrompt.js';
import { createMinimalResourceLoader } from './createMinimalResourceLoader.js';
import { ensureUserWorkspace } from './ensureUserWorkspace.js';

export type CreateSurfaceSessionOptions = {
  userMemoryWorkspace: string;
  model: SurfaceModel;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  surfaceAgentConfig: SurfaceAgentConfig;
};

/** Creates a read-only Pi surface agent session for one conversation thread. */
export async function createSurfaceSession(
  options: CreateSurfaceSessionOptions,
): Promise<AgentSession> {
  await ensureUserWorkspace(options.userMemoryWorkspace);

  const { session } = await createAgentSession({
    cwd: options.userMemoryWorkspace,
    model: options.model,
    thinkingLevel: options.surfaceAgentConfig.thinkingLevel,
    tools: ['read', 'ls', 'grep', 'find'],
    authStorage: options.authStorage,
    modelRegistry: options.modelRegistry,
    resourceLoader: createMinimalResourceLoader(buildSurfaceSystemPrompt()),
    sessionManager: SessionManager.inMemory(options.userMemoryWorkspace),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: true, maxRetries: 2 },
    }),
  });

  return session;
}
