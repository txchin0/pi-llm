import type { RespondSseEvent } from '../contracts/respond.js';
import type { AppLogger } from './types.js';

type InboundMessageFields = {
  message: string;
};

/** Logs an inbound user message with full text at `debug`, or `message_length` at `info` and above. */
export function logInboundMessage(
  logger: AppLogger,
  fields: InboundMessageFields,
): void {
  if (logger.isLevelEnabled('debug')) {
    logger.debug(
      {
        event: 'respond.request.received',
        message: fields.message,
      },
      'inbound user message',
    );
    return;
  }

  logger.info(
    {
      event: 'respond.request.received',
      message_length: fields.message.length,
    },
    'inbound user message',
  );
}

/** Logs a streamed respond SSE event with level-appropriate detail for tools and text deltas. */
export function logRespondSseEvent(
  logger: AppLogger,
  event: RespondSseEvent,
): void {
  switch (event.type) {
    case 'tool_call': {
      const base = {
        event: 'tool.call' as const,
        tool_name: event.tool_name,
        tool_call_id: event.tool_call_id,
        step: event.step,
        request_id: event.request_id,
        session_id: event.session_id,
      };

      if (logger.isLevelEnabled('debug')) {
        logger.debug({ ...base, input: event.input }, 'tool call');
      } else {
        logger.info(base, 'tool call');
      }
      return;
    }
    case 'tool_result': {
      const base = {
        event: 'tool.result' as const,
        tool_name: event.tool_name,
        tool_call_id: event.tool_call_id,
        step: event.step,
        request_id: event.request_id,
        session_id: event.session_id,
        is_error: event.is_error,
        ...(event.is_error
          ? {
              error_code: event.error_code,
              error_message: event.error_message,
            }
          : {}),
      };

      if (logger.isLevelEnabled('debug')) {
        logger.debug({ ...base, output: event.output }, 'tool result');
      } else {
        logger.info(base, 'tool result');
      }
      return;
    }
    case 'delta': {
      if (!logger.isLevelEnabled('debug')) {
        return;
      }

      logger.debug(
        { event: 'respond.delta', text: event.text },
        'assistant text delta',
      );
      return;
    }
    case 'thinking_delta': {
      if (!logger.isLevelEnabled('debug')) {
        return;
      }

      logger.debug(
        { event: 'respond.thinking_delta', text: event.text },
        'assistant thinking delta',
      );
      return;
    }
    default:
      return;
  }
}
