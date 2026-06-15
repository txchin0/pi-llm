import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import {
  mapPiEventToAgentActivity,
  type PiActivityMapperContext,
  type PiEventMapperState,
} from '../agent/mapPiEventToAgentActivity.js';
import type { AgentActivityEvent } from '../contracts/agentActivity.js';
import type {
  RequestId,
  RespondRequest,
  RespondSseEvent,
  SessionId,
} from '../contracts/respond.js';

export {
  createPiEventMapperState,
  mapStopReason,
  mapUsage,
  type PiEventMapperState,
} from '../agent/piEventMapperState.js';

export type PiEventMapperContext = {
  requestId: RequestId;
  sessionId: SessionId;
  showThinking: boolean;
  completedAt: () => string;
};

/** Maps one activity event to zero or more SSE respond events. */
function mapActivityToRespond(
  activity: AgentActivityEvent,
  context: PiEventMapperContext,
): RespondSseEvent[] {
  switch (activity.type) {
    case 'text_delta':
      return [{ type: 'delta', text: activity.text }];
    case 'thinking_delta':
      if (!context.showThinking) {
        return [];
      }

      return [{ type: 'thinking_delta', text: activity.text }];
    case 'tool_call':
      return [
        {
          type: 'tool_call',
          request_id: context.requestId,
          session_id: context.sessionId,
          step: activity.step,
          tool_call_id: activity.tool_call_id,
          tool_name: activity.tool_name,
          input: activity.input,
        },
      ];
    case 'tool_result':
      return [
        {
          type: 'tool_result',
          request_id: context.requestId,
          session_id: context.sessionId,
          step: activity.step,
          tool_call_id: activity.tool_call_id,
          tool_name: activity.tool_name,
          output: activity.output,
          is_error: activity.is_error,
          ...(activity.is_error
            ? {
                error_code: activity.error_code ?? 'tool_execution_failed',
                error_message: activity.error_message ?? 'Tool execution failed',
              }
            : {}),
        },
      ];
    case 'usage':
      return [
        {
          type: 'usage',
          request_id: context.requestId,
          usage: activity.usage,
        },
      ];
    case 'agent_error':
      return [
        {
          type: 'error',
          request_id: context.requestId,
          code: 'llm_error',
          message: activity.message,
        },
      ];
    case 'agent_finished':
      return [
        {
          type: 'final',
          request_id: context.requestId,
          finish_reason: activity.finish_reason,
          completed_at: activity.completed_at,
        },
      ];
    default: {
      const _exhaustive: never = activity;
      return _exhaustive;
    }
  }
}

/** Maps one Pi session event to zero or more SSE respond events. */
export function mapPiEventToRespond(
  event: AgentSessionEvent,
  state: PiEventMapperState,
  context: PiEventMapperContext,
): RespondSseEvent[] {
  const activityContext: PiActivityMapperContext = {
    completedAt: context.completedAt,
  };

  return mapPiEventToAgentActivity(event, state, activityContext).flatMap(
    (activity) => mapActivityToRespond(activity, context),
  );
}

export type MapPiEventOptions = {
  request: RespondRequest;
  context: Omit<PiEventMapperContext, 'showThinking'>;
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
