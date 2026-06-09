import type {
  AgentSession,
  AuthStorage,
  ModelRegistry,
} from '@earendil-works/pi-coding-agent';

import type {
  SurfaceAgentConfig,
  SurfaceModel,
} from '../../config/surfaceAgent.js';
import { resolveUserMemoryWorkspace } from '../../config/surfaceAgent.js';
import type { SessionId } from '../../contracts/respond.js';
import { createSurfaceSession } from './createSurfaceSession.js';

export type SurfaceSessionRegistryDependencies = {
  dataRoot: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: SurfaceModel;
  surfaceAgentConfig: SurfaceAgentConfig;
};

/** Holds long-lived surface `AgentSession` instances keyed by server session id. */
export class SurfaceSessionRegistry {
  private readonly sessions = new Map<SessionId, AgentSession>();
  private readonly dataRoot: string;
  private readonly authStorage: AuthStorage;
  private readonly modelRegistry: ModelRegistry;
  private readonly model: SurfaceModel;
  private readonly surfaceAgentConfig: SurfaceAgentConfig;

  /** Creates a registry with shared model and auth dependencies. */
  constructor(dependencies: SurfaceSessionRegistryDependencies) {
    this.dataRoot = dependencies.dataRoot;
    this.authStorage = dependencies.authStorage;
    this.modelRegistry = dependencies.modelRegistry;
    this.model = dependencies.model;
    this.surfaceAgentConfig = dependencies.surfaceAgentConfig;
  }

  /** Returns an existing session or creates one for the given ids. */
  async getOrCreate(sessionId: SessionId, userId: string): Promise<AgentSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const session = await createSurfaceSession({
      userMemoryWorkspace: resolveUserMemoryWorkspace(this.dataRoot, userId),
      model: this.model,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      surfaceAgentConfig: this.surfaceAgentConfig,
    });

    this.sessions.set(sessionId, session);
    return session;
  }
}
