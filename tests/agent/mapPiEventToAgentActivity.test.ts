import { describe, expect, it } from 'vitest';

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import {
  createPiEventMapperState,
  mapPiEventToAgentActivity,
} from '../../src/agent/mapPiEventToAgentActivity.js';
import { mapStopReason, mapUsage } from '../../src/agent/piEventMapperState.js';

const mapperContext = {
  completedAt: () => '2026-06-09T12:00:00.000Z',
};

function assistantMessage(
  overrides: Record<string, unknown> = {},
): AgentSessionEvent & { type: 'message_update' } {
  const usage = {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

  const message = {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text: 'Hello' }],
    api: 'openai-completions' as const,
    provider: 'llamacpp',
    model: 'local',
    usage,
    stopReason: 'stop' as const,
    timestamp: Date.now(),
    ...overrides,
  };

  return {
    type: 'message_update',
    message,
    assistantMessageEvent: {
      type: 'text_delta',
      contentIndex: 0,
      delta: 'Hi',
      partial: message,
    },
  };
}

describe('mapPiEventToAgentActivity', () => {
  it('maps text deltas', () => {
    const state = createPiEventMapperState();
    const event = assistantMessage();

    expect(mapPiEventToAgentActivity(event, state, mapperContext)).toEqual([
      { type: 'text_delta', text: 'Hi' },
    ]);
  });

  it('always maps thinking deltas', () => {
    const state = createPiEventMapperState();
    const base = assistantMessage();
    const event = {
      ...base,
      assistantMessageEvent: {
        type: 'thinking_delta' as const,
        contentIndex: 0,
        delta: 'hmm',
        partial: base.message,
      },
    } as AgentSessionEvent;

    expect(mapPiEventToAgentActivity(event, state, mapperContext)).toEqual([
      { type: 'thinking_delta', text: 'hmm' },
    ]);
  });

  it('maps tool execution start and end with shared step', () => {
    const state = createPiEventMapperState();

    expect(
      mapPiEventToAgentActivity(
        {
          type: 'tool_execution_start',
          toolCallId: 'call_1',
          toolName: 'read',
          args: { path: 'notes.md' },
        },
        state,
        mapperContext,
      ),
    ).toMatchObject([
      {
        type: 'tool_call',
        step: 1,
        tool_call_id: 'call_1',
        tool_name: 'read',
      },
    ]);

    expect(
      mapPiEventToAgentActivity(
        {
          type: 'tool_execution_end',
          toolCallId: 'call_1',
          toolName: 'read',
          result: { content: 'ok' },
          isError: false,
        },
        state,
        mapperContext,
      ),
    ).toMatchObject([
      {
        type: 'tool_result',
        step: 1,
        is_error: false,
      },
    ]);
  });

  it('maps terminal agent_end to usage and agent_finished', () => {
    const state = createPiEventMapperState();
    const message = assistantMessage({ stopReason: 'toolUse' }).message;

    expect(
      mapPiEventToAgentActivity(
        {
          type: 'agent_end',
          messages: [message],
          willRetry: false,
        },
        state,
        mapperContext,
      ),
    ).toEqual([
      {
        type: 'usage',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
        },
      },
      {
        type: 'agent_finished',
        finish_reason: 'tool-calls',
        completed_at: '2026-06-09T12:00:00.000Z',
      },
    ]);
  });

  it('emits agent_error when the assistant ends with an error stop reason', () => {
    const state = createPiEventMapperState();
    const message = assistantMessage({
      stopReason: 'error',
      errorMessage: "400 model 'local' not found",
    }).message;

    expect(
      mapPiEventToAgentActivity(
        {
          type: 'agent_end',
          messages: [message],
          willRetry: false,
        },
        state,
        mapperContext,
      ),
    ).toEqual(
      expect.arrayContaining([
        {
          type: 'agent_error',
          message: "400 model 'local' not found",
        },
        {
          type: 'agent_finished',
          finish_reason: 'error',
          completed_at: '2026-06-09T12:00:00.000Z',
        },
      ]),
    );
  });

  it('skips agent_end while a retry is pending', () => {
    const state = createPiEventMapperState();

    expect(
      mapPiEventToAgentActivity(
        {
          type: 'agent_end',
          messages: [assistantMessage().message],
          willRetry: true,
        },
        state,
        mapperContext,
      ),
    ).toEqual([]);
  });
});

describe('mapStopReason', () => {
  it('maps provider stop reasons', () => {
    expect(mapStopReason('stop')).toBe('stop');
    expect(mapStopReason('toolUse')).toBe('tool-calls');
    expect(mapStopReason('aborted')).toBe('error');
  });
});

describe('mapUsage', () => {
  it('maps token fields', () => {
    expect(
      mapUsage({
        input: 10,
        output: 5,
        totalTokens: 15,
      }),
    ).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    });
  });
});
