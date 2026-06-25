import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import type { AgentActivityEvent } from '../contracts/agentActivity.js';
import { extractAssistantOutcome, findLastAssistantMessage } from './extractAssistantOutcome.js';
import { isAssistantMessageSlice } from './piAssistantMessage.js';
import {
  mapStopReason,
  mapUsage,
  type PiActivityMapperContext,
  type PiEventMapperState,
} from './piEventMapperState.js';

export {
  createPiEventMapperState,
  mapStopReason,
  mapUsage,
  type PiActivityMapperContext,
  type PiEventMapperState,
} from './piEventMapperState.js';

/** Maps one Pi session event to zero or more shared activity events. */
export function mapPiEventToAgentActivity(
  event: AgentSessionEvent,
  state: PiEventMapperState,
  context: PiActivityMapperContext,
): AgentActivityEvent[] {
  switch (event.type) {
    case 'message_update': {
      const assistantEvent = event.assistantMessageEvent;
      if (assistantEvent.type === 'text_delta') {
        return [{ type: 'text_delta', text: assistantEvent.delta }];
      }

      if (assistantEvent.type === 'thinking_delta') {
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
          step,
          tool_call_id: event.toolCallId,
          tool_name: event.toolName,
          output: event.result,
          is_error: false,
        },
      ];
    }
    case 'agent_end': {
      const outcome = extractAssistantOutcome(event);
      if (outcome.kind === 'retry') {
        return [];
      }

      const assistantMessage = findLastAssistantMessage(
        event.messages,
        isAssistantMessageSlice,
      );
      const events: AgentActivityEvent[] = [];

      if (assistantMessage) {
        events.push({
          type: 'usage',
          usage: mapUsage(assistantMessage.usage),
        });

        if (outcome.kind === 'error') {
          events.push({
            type: 'agent_error',
            message: outcome.message,
          });
        }
      }

      events.push({
        type: 'agent_finished',
        finish_reason: assistantMessage
          ? mapStopReason(assistantMessage.stopReason)
          : 'unknown',
        completed_at: context.completedAt(),
      });

      return events;
    }
    case 'agent_start':
    case 'turn_start':
    case 'turn_end':
    case 'message_start':
    case 'message_end':
    case 'tool_execution_update':
    case 'queue_update':
    case 'compaction_start':
    case 'compaction_end':
    case 'auto_retry_start':
    case 'auto_retry_end':
    case 'session_info_changed':
    case 'thinking_level_changed':
      return [];
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}
