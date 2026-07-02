import type {
  AgentSession,
  AuthStorage,
  ModelRegistry,
} from '@earendil-works/pi-coding-agent';

import {
  resolveUserMemoryWorkspace,
  type AgentLlmConfig,
  type AgentModel,
} from '../config/agentLlm.js';
import type { SessionId } from '../contracts/respond.js';
import { resolveEnabledIntegrations } from '../integrations/resolveEnabledIntegrations.js';
import type { OAuthService } from '../integrations/oauth/oauthService.js';
import type { IntegrationStore } from '../integrations/store/integrationStore.js';
import type { AppLogger } from '../logging/types.js';
import type { TaskQueue } from '../queue/taskQueue.js';
import { createSurfaceSession } from './createSurfaceSession.js';

export type SurfaceSessionRegistryDependencies = {
  dataRoot: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: AgentModel;
  agentConfig: AgentLlmConfig;
  taskQueue: TaskQueue;
  contextTurnLimit: number;
  maxSessions: number;
  integrationStore: IntegrationStore;
  oauthService: OAuthService;
  log?: AppLogger;
};

/** Holds long-lived surface `AgentSession` instances keyed by server session id. */
export class SurfaceSessionRegistry {
  private readonly sessions = new Map<SessionId, AgentSession>();
  private readonly dataRoot: string;
  private readonly authStorage: AuthStorage;
  private readonly modelRegistry: ModelRegistry;
  private readonly model: AgentModel;
  private readonly agentConfig: AgentLlmConfig;
  private readonly taskQueue: TaskQueue;
  private readonly contextTurnLimit: number;
  private readonly maxSessions: number;
  private readonly integrationStore: IntegrationStore;
  private readonly oauthService: OAuthService;
  private readonly log: AppLogger | undefined;

  /** Creates a registry with shared model and auth dependencies. */
  constructor(dependencies: SurfaceSessionRegistryDependencies) {
    this.dataRoot = dependencies.dataRoot;
    this.authStorage = dependencies.authStorage;
    this.modelRegistry = dependencies.modelRegistry;
    this.model = dependencies.model;
    this.agentConfig = dependencies.agentConfig;
    this.taskQueue = dependencies.taskQueue;
    this.contextTurnLimit = dependencies.contextTurnLimit;
    this.maxSessions = dependencies.maxSessions;
    this.integrationStore = dependencies.integrationStore;
    this.oauthService = dependencies.oauthService;
    this.log = dependencies.log;
  }

  /** Returns an existing session or creates one for the given ids. */
  async getOrCreate(sessionId: SessionId, userId: string): Promise<AgentSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.touchSession(sessionId, existing);
      return existing;
    }

    this.evictIfNeeded();

    const enabledIntegrations = await resolveEnabledIntegrations(
      this.integrationStore,
      userId,
      this.log ? { log: this.log } : {},
    );

    const sessionOptions = {
      userId,
      sessionId,
      userMemoryWorkspace: resolveUserMemoryWorkspace(this.dataRoot, userId),
      dataRoot: this.dataRoot,
      model: this.model,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      agentConfig: this.agentConfig,
      taskQueue: this.taskQueue,
      contextTurnLimit: this.contextTurnLimit,
      enabledIntegrations,
      oauthService: this.oauthService,
    };
    const session = await createSurfaceSession(
      this.log ? { ...sessionOptions, log: this.log } : sessionOptions,
    );

    this.sessions.set(sessionId, session);
    return session;
  }

  /** Marks a session as recently used for LRU eviction. */
  private touchSession(sessionId: SessionId, session: AgentSession): void {
    this.sessions.delete(sessionId);
    this.sessions.set(sessionId, session);
  }

  /** Evicts the least-recently-used idle session when at capacity. */
  private evictIfNeeded(): void {
    while (this.sessions.size >= this.maxSessions) {
      let evicted = false;

      for (const [sessionId, session] of this.sessions) {
        if (session.isStreaming) {
          continue;
        }

        this.sessions.delete(sessionId);
        this.log?.info(
          {
            event: 'surface.session.evicted',
            session_id: sessionId,
          },
          'surface session evicted',
        );
        evicted = true;
        break;
      }

      if (!evicted) {
        break;
      }
    }
  }
}
