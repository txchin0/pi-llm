import { describe, expect, it } from 'vitest';

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import { extractAssistantOutcome } from '../../src/agent/extractAssistantOutcome.js';

type AgentEndEvent = Extract<AgentSessionEvent, { type: 'agent_end' }>;
type AgentMessage = AgentEndEvent['messages'][number];

const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

/** Builds a minimal Pi assistant message for agent_end test fixtures. */
function assistantMessage(
  overrides: Pick<Extract<AgentMessage, { role: 'assistant' }>, 'stopReason'> &
    Partial<Pick<Extract<AgentMessage, { role: 'assistant' }>, 'errorMessage'>>,
): AgentMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'openai',
    model: 'test-model',
    usage: emptyUsage,
    timestamp: 0,
    ...overrides,
  };
}

function agentEnd(overrides: Partial<AgentEndEvent> = {}): AgentEndEvent {
  return {
    type: 'agent_end',
    willRetry: false,
    messages: [assistantMessage({ stopReason: 'stop' })],
    ...overrides,
  };
}

describe('extractAssistantOutcome', () => {
  it('returns retry when Pi will retry internally', () => {
    expect(
      extractAssistantOutcome(agentEnd({ willRetry: true })),
    ).toEqual({ kind: 'retry' });
  });

  it('returns complete for a successful stop', () => {
    expect(extractAssistantOutcome(agentEnd())).toEqual({
      kind: 'complete',
      stopReason: 'stop',
    });
  });

  it('returns error for terminal LLM error stop reasons', () => {
    expect(
      extractAssistantOutcome(
        agentEnd({
          messages: [
            assistantMessage({
              stopReason: 'error',
              errorMessage: 'model exploded',
            }),
          ],
        }),
      ),
    ).toEqual({
      kind: 'error',
      message: 'model exploded',
    });
  });

  it('returns error for aborted stop reasons', () => {
    expect(
      extractAssistantOutcome(
        agentEnd({
          messages: [
            assistantMessage({
              stopReason: 'aborted',
            }),
          ],
        }),
      ),
    ).toEqual({
      kind: 'error',
      message: 'LLM request failed before a response was generated.',
    });
  });
});
