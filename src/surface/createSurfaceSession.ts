import type { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';

import type {
  SurfaceAgentConfig,
  SurfaceModel,
} from '../config/surfaceAgent.js';
import { validateSurfaceLlmEndpoint } from '../config/surfaceAgent.js';
import type { SessionId } from '../contracts/respond.js';
import type { AppLogger } from '../logging/types.js';
import type { TaskQueue } from '../queue/taskQueue.js';
import {
  AgentSession,
  createAgentSession,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

import { buildSurfaceSystemPrompt } from './buildSurfaceSystemPrompt.js';
import { createSurfaceResourceLoader } from './createSurfaceResourceLoader.js';
import {
  createSurfaceExtensionFactory,
  type SurfaceExtensionDependencies,
} from './extensions/surfaceExtension.js';
import { ensureUserWorkspace } from './util/ensureUserWorkspace.js';

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
    extensionFactories: [
      createSurfaceExtensionFactory(buildSurfaceExtensionDependencies(options)),
    ],
  });

  const { session, extensionsResult } = await createAgentSession({
    cwd: options.userMemoryWorkspace,
    model: options.model,
    thinkingLevel: options.surfaceAgentConfig.thinkingLevel,
    tools: ['read', 'ls', 'grep', 'find', 'web_search', 'schedule_task'],
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
