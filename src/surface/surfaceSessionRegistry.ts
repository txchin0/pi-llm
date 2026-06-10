import type {
  AgentSession,
  AuthStorage,
  ModelRegistry,
} from '@earendil-works/pi-coding-agent';

import type {
  SurfaceAgentConfig,
  SurfaceModel,
} from '../config/surfaceAgent.js';
import { resolveUserMemoryWorkspace } from '../config/surfaceAgent.js';
import type { SessionId } from '../contracts/respond.js';
import type { AppLogger } from '../logging/types.js';
import { createSurfaceSession } from './createSurfaceSession.js';

export type SurfaceSessionRegistryDependencies = {
  dataRoot: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: SurfaceModel;
  surfaceAgentConfig: SurfaceAgentConfig;
  log?: AppLogger;
};

/** Holds long-lived surface `AgentSession` instances keyed by server session id. */
export class SurfaceSessionRegistry {
  private readonly sessions = new Map<SessionId, AgentSession>();
  private readonly dataRoot: string;
  private readonly authStorage: AuthStorage;
  private readonly modelRegistry: ModelRegistry;
  private readonly model: SurfaceModel;
  private readonly surfaceAgentConfig: SurfaceAgentConfig;
  private readonly log: AppLogger | undefined;

  /** Creates a registry with shared model and auth dependencies. */
  constructor(dependencies: SurfaceSessionRegistryDependencies) {
    this.dataRoot = dependencies.dataRoot;
    this.authStorage = dependencies.authStorage;
    this.modelRegistry = dependencies.modelRegistry;
    this.model = dependencies.model;
    this.surfaceAgentConfig = dependencies.surfaceAgentConfig;
    this.log = dependencies.log;
  }

  /** Returns an existing session or creates one for the given ids. */
  async getOrCreate(sessionId: SessionId, userId: string): Promise<AgentSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const sessionOptions = {
      userMemoryWorkspace: resolveUserMemoryWorkspace(this.dataRoot, userId),
      dataRoot: this.dataRoot,
      model: this.model,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      surfaceAgentConfig: this.surfaceAgentConfig,
    };
    const session = await createSurfaceSession(
      this.log ? { ...sessionOptions, log: this.log } : sessionOptions,
    );

    this.sessions.set(sessionId, session);
    return session;
  }
}
