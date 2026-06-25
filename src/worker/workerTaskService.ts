import type { AuthStorage, AgentSession, AgentSessionEvent, ModelRegistry } from '@earendil-works/pi-coding-agent';

import { extractAssistantOutcome } from '../agent/extractAssistantOutcome.js';
import { runAgentPrompt } from '../agent/runAgentPrompt.js';
import { resolveUserMemoryWorkspace } from '../config/agentLlm.js';
import type {
  WorkerAgentConfig,
  WorkerModel,
} from '../config/workerAgent.js';
import type { AppLogger } from '../logging/types.js';
import type { IntegrationStore } from '../integrations/store/integrationStore.js';
import { noopOAuthService } from '../integrations/oauth/noopOAuthService.js';
import type { OAuthService } from '../integrations/oauth/oauthService.js';
import { resolveEnabledIntegrations } from '../integrations/resolveEnabledIntegrations.js';
import type { TaskRecord } from '../queue/taskTypes.js';
import { formatNowInTimezone } from '../agent/piMessageText.js';

import { buildWorkerTaskPrompt } from './buildWorkerTaskPrompt.js';
import { createWorkerSession } from './createWorkerSession.js';
import type { WorkerRunOutcome, WorkerRunTraceSink } from './workerRunTrace.js';

export type WorkerTaskService = {
  runTask(task: TaskRecord, signal: AbortSignal): Promise<string>;
};

export type WorkerSessionFactory = (
  options: Parameters<typeof createWorkerSession>[0],
) => Promise<AgentSession>;

export type WorkerPromptRunner = (
  session: AgentSession,
  prompt: string,
  options: { signal: AbortSignal; log?: AppLogger; trace?: WorkerRunTraceSink },
) => Promise<string>;

export type WorkerTraceFactory = (
  task: TaskRecord,
  startedAt: string,
) => WorkerRunTraceSink;

export type WorkerTaskServiceDependencies = {
  dataRoot: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: WorkerModel;
  workerAgentConfig: WorkerAgentConfig;
  integrationStore: IntegrationStore;
  oauthService?: OAuthService;
  logger?: AppLogger;
  now?: () => string;
  createSession?: WorkerSessionFactory;
  runPrompt?: WorkerPromptRunner;
  createTrace?: WorkerTraceFactory;
};

/** Logs Pi tool execution events at info without payload bodies. */
function logToolEvent(log: AppLogger | undefined, event: AgentSessionEvent): void {
  switch (event.type) {
    case 'tool_execution_start':
      log?.info(
        {
          event: 'tool.call',
          tool_name: event.toolName,
          tool_call_id: event.toolCallId,
        },
        'worker tool call',
      );
      return;
    case 'tool_execution_end':
      log?.info(
        {
          event: 'tool.result',
          tool_name: event.toolName,
          tool_call_id: event.toolCallId,
          is_error: event.isError,
        },
        'worker tool result',
      );
      return;
    default:
      return;
  }
}

/** Resolves the terminal worker trace outcome from success, error, or abort. */
export function resolveWorkerRunOutcome(
  error: unknown,
  signal: AbortSignal,
  summaryLength: number,
): WorkerRunOutcome {
  if (error === undefined) {
    return { kind: 'completed', summaryLength };
  }

  if (signal.aborted) {
    const reason: unknown = signal.reason;
    if (reason instanceof Error && reason.message === 'Worker task timed out') {
      return { kind: 'timeout' };
    }

    return { kind: 'aborted' };
  }

  const message =
    error instanceof Error ? error.message : 'Worker task failed';
  return { kind: 'error', message };
}

/**
 * Runs one worker prompt via the shared agent runner, accumulates assistant text,
 * and throws on terminal LLM errors or abort.
 */
export async function runWorkerPrompt(
  session: AgentSession,
  message: string,
  options: { signal: AbortSignal; log?: AppLogger; trace?: WorkerRunTraceSink },
): Promise<string> {
  let summary = '';

  for await (const event of runAgentPrompt(session, message, {
    signal: options.signal,
  })) {
    options.trace?.onEvent(event);
    logToolEvent(options.log, event);

    if (event.type === 'message_update') {
      const assistantEvent = event.assistantMessageEvent;
      if (assistantEvent.type === 'text_delta') {
        summary += assistantEvent.delta;
      }
    }

    if (event.type === 'agent_end') {
      const outcome = extractAssistantOutcome(event);
      if (outcome.kind === 'retry') {
        continue;
      }

      if (outcome.kind === 'error') {
        throw new Error(outcome.message);
      }
    }
  }

  return summary;
}

/** Creates the worker task execution service. */
export function createWorkerTaskService(
  dependencies: WorkerTaskServiceDependencies,
): WorkerTaskService {
  const createSession = dependencies.createSession ?? createWorkerSession;
  const runPrompt = dependencies.runPrompt ?? runWorkerPrompt;
  const oauthService = dependencies.oauthService ?? noopOAuthService;

  return {
    async runTask(task, signal) {
      const log = dependencies.logger?.child({
        component: 'worker',
        task_id: task.id,
        user_id: task.userId,
        ...(task.sessionId ? { session_id: task.sessionId } : {}),
      });

      const now = dependencies.now ?? (() => formatNowInTimezone());
      const startedAt = now();
      const prompt = buildWorkerTaskPrompt(task, startedAt);
      const trace = dependencies.createTrace?.(task, startedAt);
      const userMemoryWorkspace = resolveUserMemoryWorkspace(
        dependencies.dataRoot,
        task.userId,
      );

      const enabledIntegrations = await resolveEnabledIntegrations(
        dependencies.integrationStore,
        task.userId,
        log ? { log } : {},
      );

      const sessionOptions = {
        userId: task.userId,
        userMemoryWorkspace,
        dataRoot: dependencies.dataRoot,
        model: dependencies.model,
        authStorage: dependencies.authStorage,
        modelRegistry: dependencies.modelRegistry,
        workerAgentConfig: dependencies.workerAgentConfig,
        enabledIntegrations,
        oauthService,
      };

      const session = await createSession(
        log ? { ...sessionOptions, log } : sessionOptions,
      );

      const promptOptions = {
        signal,
        ...(log === undefined ? {} : { log }),
        ...(trace === undefined ? {} : { trace }),
      };

      let summary = '';
      let runError: unknown;

      try {
        summary = await runPrompt(session, prompt, promptOptions);

        log?.info(
          {
            event: 'worker.agent.completed',
            summary_length: summary.length,
          },
          'worker agent completed',
        );

        return summary;
      } catch (error) {
        runError = error;
        throw error;
      } finally {
        if (trace !== undefined) {
          await trace.close(
            resolveWorkerRunOutcome(runError, signal, summary.length),
          );
        }
      }
    },
  };
}
