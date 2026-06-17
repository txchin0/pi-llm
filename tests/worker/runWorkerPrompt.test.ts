import { describe, expect, it, vi } from 'vitest';

import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import { runAgentPrompt } from '../../src/agent/runAgentPrompt.js';
import {
  resolveWorkerRunOutcome,
  runWorkerPrompt,
} from '../../src/worker/workerTaskService.js';
import type { WorkerRunTraceSink } from '../../src/worker/workerRunTrace.js';

vi.mock('../../src/agent/runAgentPrompt.js', () => ({
  runAgentPrompt: vi.fn(),
}));

function createMockTrace(): WorkerRunTraceSink & {
  events: AgentSessionEvent[];
  outcomes: Array<ReturnType<typeof resolveWorkerRunOutcome>>;
} {
  const events: AgentSessionEvent[] = [];
  const outcomes: Array<ReturnType<typeof resolveWorkerRunOutcome>> = [];

  return {
    events,
    outcomes,
    onEvent(event) {
      events.push(event);
    },
    close(outcome) {
      outcomes.push(outcome);
      return Promise.resolve();
    },
  };
}

describe('runWorkerPrompt', () => {
  it('forwards events to the trace sink without changing summary behavior', async () => {
    const session = { prompt: vi.fn() } as unknown as AgentSession;
    const trace = createMockTrace();
    const events: AgentSessionEvent[] = [
      {
        type: 'message_update',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
          api: 'openai-completions',
          provider: 'llamacpp',
          model: 'local',
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: Date.now(),
        },
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: 'Hello',
          partial: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello' }],
            api: 'openai-completions',
            provider: 'llamacpp',
            model: 'local',
            usage: {
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 2,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: 'stop',
            timestamp: Date.now(),
          },
        },
      },
      {
        type: 'agent_end',
        messages: [],
        willRetry: false,
      },
    ];

    vi.mocked(runAgentPrompt).mockImplementation(async function* () {
      for (const event of events) {
        yield event;
      }
    });

    const summary = await runWorkerPrompt(session, 'task prompt', {
      signal: new AbortController().signal,
      trace,
    });

    expect(summary).toBe('Hello');
    expect(trace.events).toEqual(events);
  });

  it('still throws on terminal agent errors when a trace sink is attached', async () => {
    const session = { prompt: vi.fn() } as unknown as AgentSession;
    const trace = createMockTrace();

    vi.mocked(runAgentPrompt).mockImplementation(async function* () {
      yield {
        type: 'agent_end',
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'fail' }],
            api: 'openai-completions',
            provider: 'llamacpp',
            model: 'local',
            usage: {
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 2,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: 'error',
            errorMessage: 'model unavailable',
            timestamp: Date.now(),
          },
        ],
        willRetry: false,
      };
    });

    await expect(
      runWorkerPrompt(session, 'task prompt', {
        signal: new AbortController().signal,
        trace,
      }),
    ).rejects.toThrow('model unavailable');
  });
});

describe('resolveWorkerRunOutcome', () => {
  it('maps success, timeout, abort, and error outcomes', () => {
    const signal = new AbortController().signal;

    expect(resolveWorkerRunOutcome(undefined, signal, 12)).toEqual({
      kind: 'completed',
      summaryLength: 12,
    });

    const timeoutController = new AbortController();
    timeoutController.abort(new Error('Worker task timed out'));
    expect(
      resolveWorkerRunOutcome(new Error('Worker task timed out'), timeoutController.signal, 0),
    ).toEqual({ kind: 'timeout' });

    const abortController = new AbortController();
    abortController.abort();
    expect(
      resolveWorkerRunOutcome(new Error('stopped'), abortController.signal, 0),
    ).toEqual({ kind: 'aborted' });

    expect(resolveWorkerRunOutcome(new Error('boom'), signal, 0)).toEqual({
      kind: 'error',
      message: 'boom',
    });
  });
});
