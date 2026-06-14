import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

type ProviderStopReason =
  | 'stop'
  | 'length'
  | 'toolUse'
  | 'error'
  | 'aborted';

type AssistantMessageSlice = {
  role: 'assistant';
  stopReason: ProviderStopReason;
  errorMessage?: string;
};

/** Outcome of an `agent_end` event after Pi-internal retry filtering. */
export type AssistantOutcome =
  | { kind: 'retry' }
  | { kind: 'error'; message: string }
  | { kind: 'complete'; stopReason: ProviderStopReason };

/** Returns true when a Pi message has assistant completion fields. */
function isAssistantMessageSlice(
  message: { role: string },
): message is AssistantMessageSlice {
  return message.role === 'assistant' && 'stopReason' in message;
}

/**
 * Returns the last assistant message from an agent_end payload that matches
 * `predicate`, scanning from the end of the message list.
 */
export function findLastAssistantMessage<T extends { role: string }>(
  messages: readonly { role: string }[],
  predicate: (message: { role: string }) => message is T,
): T | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || !predicate(message)) {
      continue;
    }

    return message;
  }

  return undefined;
}

/**
 * Interprets a terminal `agent_end` event for queue-owned retry and error handling.
 * Returns `retry` when Pi will retry internally; callers should ignore the event.
 */
export function extractAssistantOutcome(
  event: Extract<AgentSessionEvent, { type: 'agent_end' }>,
): AssistantOutcome {
  if (event.willRetry) {
    return { kind: 'retry' };
  }

  const assistantMessage = findLastAssistantMessage(
    event.messages,
    isAssistantMessageSlice,
  );
  if (
    assistantMessage?.stopReason === 'error' ||
    assistantMessage?.stopReason === 'aborted'
  ) {
    return {
      kind: 'error',
      message:
        assistantMessage.errorMessage ??
        'LLM request failed before a response was generated.',
    };
  }

  return {
    kind: 'complete',
    stopReason: assistantMessage?.stopReason ?? 'stop',
  };
}
