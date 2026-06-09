import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import type {
  ProviderFinishReason,
  ProviderUsage,
} from '../../contracts/provider.js';
import type {
  RequestId,
  RespondRequest,
  RespondSseEvent,
  SessionId,
} from '../../contracts/respond.js';

type ProviderStopReason =
  | 'stop'
  | 'length'
  | 'toolUse'
  | 'error'
  | 'aborted';

type AssistantUsageSlice = {
  input: number;
  output: number;
  totalTokens: number;
};

type AssistantMessageSlice = {
  role: 'assistant';
  usage: AssistantUsageSlice;
  stopReason: ProviderStopReason;
};

export type PiEventMapperContext = {
  requestId: RequestId;
  sessionId: SessionId;
  showThinking: boolean;
  completedAt: () => string;
};

export type PiEventMapperState = {
  step: number;
  toolSteps: Map<string, number>;
};

/** Creates mutable mapper state for one respond request. */
export function createPiEventMapperState(): PiEventMapperState {
  return {
    step: 0,
    toolSteps: new Map(),
  };
}

/** Maps Pi `StopReason` values to the respond contract finish reason. */
export function mapStopReason(stopReason: ProviderStopReason): ProviderFinishReason {
  switch (stopReason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'toolUse':
      return 'tool-calls';
    case 'error':
    case 'aborted':
      return 'error';
    default:
      return 'unknown';
  }
}

/** Maps Pi usage fields to the respond usage contract. */
export function mapUsage(usage: AssistantUsageSlice): ProviderUsage {
  return {
    input_tokens: usage.input,
    output_tokens: usage.output,
    total_tokens: usage.totalTokens,
  };
}

/** Returns the last assistant message from an agent_end payload. */
function findLastAssistantMessage(
  messages: readonly { role: string }[],
): AssistantMessageSlice | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') {
      continue;
    }

    return message as AssistantMessageSlice;
  }

  return undefined;
}

/** Maps one Pi session event to zero or more SSE respond events. */
export function mapPiEventToRespond(
  event: AgentSessionEvent,
  state: PiEventMapperState,
  context: PiEventMapperContext,
): RespondSseEvent[] {
  switch (event.type) {
    case 'message_update': {
      const assistantEvent = event.assistantMessageEvent;
      if (assistantEvent.type === 'text_delta') {
        return [{ type: 'delta', text: assistantEvent.delta }];
      }

      if (
        assistantEvent.type === 'thinking_delta' &&
        context.showThinking
      ) {
        return [{ type: 'thinking_delta', text: assistantEvent.delta }];
      }

      return [];
    }
    case 'tool_execution_start': {
      state.step += 1;
      state.toolSteps.set(event.toolCallId, state.step);

      return [
        {
          type: 'tool_call',
          request_id: context.requestId,
          session_id: context.sessionId,
          step: state.step,
          tool_call_id: event.toolCallId,
          tool_name: event.toolName,
          input: event.args,
        },
      ];
    }
    case 'tool_execution_end': {
      const step = state.toolSteps.get(event.toolCallId) ?? state.step;

      if (event.isError) {
        return [
          {
            type: 'tool_result',
            request_id: context.requestId,
            session_id: context.sessionId,
            step,
            tool_call_id: event.toolCallId,
            tool_name: event.toolName,
            output: event.result,
            is_error: true,
            error_code: 'tool_execution_failed',
            error_message:
              typeof event.result === 'string'
                ? event.result
                : 'Tool execution failed',
          },
        ];
      }

      return [
        {
          type: 'tool_result',
          request_id: context.requestId,
          session_id: context.sessionId,
          step,
          tool_call_id: event.toolCallId,
          tool_name: event.toolName,
          output: event.result,
          is_error: false,
        },
      ];
    }
    case 'agent_end': {
      if (event.willRetry) {
        return [];
      }

      const assistantMessage = findLastAssistantMessage(event.messages);
      const events: RespondSseEvent[] = [];

      if (assistantMessage) {
        events.push({
          type: 'usage',
          request_id: context.requestId,
          usage: mapUsage(assistantMessage.usage),
        });
      }

      events.push({
        type: 'final',
        request_id: context.requestId,
        finish_reason: assistantMessage
          ? mapStopReason(assistantMessage.stopReason)
          : 'unknown',
        completed_at: context.completedAt(),
      });

      return events;
    }
    default:
      return [];
  }
}

export type MapPiEventOptions = {
  request: RespondRequest;
  context: PiEventMapperContext;
  state: PiEventMapperState;
};

/** Convenience wrapper that applies request-level thinking visibility. */
export function mapPiEventForRequest(
  event: AgentSessionEvent,
  options: MapPiEventOptions,
): RespondSseEvent[] {
  return mapPiEventToRespond(event, options.state, {
    ...options.context,
    showThinking: options.request.show_thinking === true,
  });
}
