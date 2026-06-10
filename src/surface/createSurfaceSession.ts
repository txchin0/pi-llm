import type { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';

import type {
  SurfaceAgentConfig,
  SurfaceModel,
} from '../config/surfaceAgent.js';
import { validateSurfaceLlmEndpoint } from '../config/surfaceAgent.js';
import type { AppLogger } from '../logging/types.js';
import {
  AgentSession,
  createAgentSession,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

import { buildSurfaceSystemPrompt } from './buildSurfaceSystemPrompt.js';
import { createSurfaceResourceLoader } from './createSurfaceResourceLoader.js';
import { ensureUserWorkspace } from './util/ensureUserWorkspace.js';

export type CreateSurfaceSessionOptions = {
  userMemoryWorkspace: string;
  dataRoot: string;
  model: SurfaceModel;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  surfaceAgentConfig: SurfaceAgentConfig;
  log?: AppLogger;
};

/** Creates a read-only Pi surface agent session for one conversation thread. */
export async function createSurfaceSession(
  options: CreateSurfaceSessionOptions,
): Promise<AgentSession> {
  await validateSurfaceLlmEndpoint(options.surfaceAgentConfig);
  await ensureUserWorkspace(options.userMemoryWorkspace);

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 2 },
  });

  const resourceLoader = await createSurfaceResourceLoader({
    cwd: options.userMemoryWorkspace,
    dataRoot: options.dataRoot,
    systemPrompt: buildSurfaceSystemPrompt(),
    settingsManager,
  });

  const { session, extensionsResult } = await createAgentSession({
    cwd: options.userMemoryWorkspace,
    model: options.model,
    thinkingLevel: options.surfaceAgentConfig.thinkingLevel,
    tools: ['read', 'ls', 'grep', 'find', 'web_search'],
    authStorage: options.authStorage,
    modelRegistry: options.modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(options.userMemoryWorkspace),
    settingsManager,
  });

  for (const { path, error } of extensionsResult.errors) {
    options.log?.warn(
      { event: 'surface.extension.load_error', path, error },
      'surface extension failed to load',
    );
  }

  return session;
}
