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
import { resolveEnabledIntegrations } from '../integrations/resolveEnabledIntegrations.js';
import type { TaskRecord } from '../queue/taskTypes.js';
import { formatNowInTimezone } from '../surface/util/enrichUserMessage.js';

import { buildWorkerTaskPrompt } from './buildWorkerTaskPrompt.js';
import { createWorkerSession } from './createWorkerSession.js';

export type WorkerTaskService = {
  runTask(task: TaskRecord, signal: AbortSignal): Promise<string>;
};

export type WorkerSessionFactory = (
  options: Parameters<typeof createWorkerSession>[0],
) => Promise<AgentSession>;

export type WorkerPromptRunner = (
  session: AgentSession,
  prompt: string,
  options: { signal: AbortSignal; log?: AppLogger },
) => Promise<string>;

export type WorkerTaskServiceDependencies = {
  dataRoot: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: WorkerModel;
  workerAgentConfig: WorkerAgentConfig;
  integrationStore: IntegrationStore;
  logger?: AppLogger;
  now?: () => string;
  createSession?: WorkerSessionFactory;
  runPrompt?: WorkerPromptRunner;
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

/**
 * Runs one worker prompt via the shared agent runner, accumulates assistant text,
 * and throws on terminal LLM errors or abort.
 */
export async function runWorkerPrompt(
  session: AgentSession,
  message: string,
  options: { signal: AbortSignal; log?: AppLogger },
): Promise<string> {
  let summary = '';

  for await (const event of runAgentPrompt(session, message, {
    signal: options.signal,
  })) {
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

  return {
    async runTask(task, signal) {
      const log = dependencies.logger?.child({
        component: 'worker',
        task_id: task.id,
        user_id: task.userId,
        ...(task.sessionId ? { session_id: task.sessionId } : {}),
      });

      const now = dependencies.now ?? (() => formatNowInTimezone());
      const prompt = buildWorkerTaskPrompt(task, now());
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
      };

      const session = await createSession(
        log ? { ...sessionOptions, log } : sessionOptions,
      );

      const promptOptions = log === undefined ? { signal } : { signal, log };

      const summary = await runPrompt(session, prompt, promptOptions);

      log?.info(
        {
          event: 'worker.agent.completed',
          summary_length: summary.length,
        },
        'worker agent completed',
      );

      return summary;
    },
  };
}
