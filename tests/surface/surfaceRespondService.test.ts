import { describe, expect, it, vi } from 'vitest';

import type { AgentSession } from '@earendil-works/pi-coding-agent';

import type { RespondSseEvent } from '../../src/contracts/respond.js';
import { createSurfaceRespondService } from '../../src/surface/surfaceRespondService.js';
import type { SurfaceSessionRegistry } from '../../src/surface/surfaceSessionRegistry.js';

vi.mock('../../src/agent/runAgentPrompt.js', () => ({
  runAgentPrompt: vi.fn(async function* () {
    yield {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'from-runner' },
    } as import('@earendil-works/pi-coding-agent').AgentSessionEvent;
  }),
}));

import { runAgentPrompt } from '../../src/agent/runAgentPrompt.js';

const context = {
  requestId: 'req_test00000001' as const,
  sessionId: 'sess_test00000001' as const,
  startedAt: '2026-06-09T12:00:00.000Z',
};

async function collectEvents(
  service: ReturnType<typeof createSurfaceRespondService>,
  request: { user_id: string; message: string; show_thinking?: boolean },
): Promise<RespondSseEvent[]> {
  const events: RespondSseEvent[] = [];
  for await (const event of service.handleTurn(request, context)) {
    events.push(event);
  }
  return events;
}

describe('createSurfaceRespondService', () => {
  it('returns session_busy when the session is already streaming', async () => {
    const registry = {
      getOrCreate: vi.fn(async () => ({ isStreaming: true }) as AgentSession),
    } as unknown as SurfaceSessionRegistry;

    const service = createSurfaceRespondService({ registry });
    const events = await collectEvents(service, {
      user_id: 'web-user',
      message: 'hello',
    });

    expect(events).toEqual([
      {
        type: 'error',
        request_id: context.requestId,
        code: 'session_busy',
        message: 'Surface session is already processing a request.',
      },
    ]);
    expect(runAgentPrompt).not.toHaveBeenCalled();
  });

  it('invokes runAgentPrompt with an enriched message', async () => {
    vi.mocked(runAgentPrompt).mockClear();

    const registry = {
      getOrCreate: vi.fn(async () => ({ isStreaming: false }) as AgentSession),
    } as unknown as SurfaceSessionRegistry;

    const service = createSurfaceRespondService({
      registry,
      now: () => '2026-06-09T12:00:00.000Z',
    });

    const events = await collectEvents(service, {
      user_id: 'web-user',
      message: 'hello',
    });

    expect(events).toEqual([{ type: 'delta', text: 'from-runner' }]);
    expect(runAgentPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ isStreaming: false }),
      '[Current time: 2026-06-09T12:00:00.000Z]\n\nhello',
    );
  });

  it('maps prompt failures to agent_error', async () => {
    vi.mocked(runAgentPrompt).mockImplementation(async function* () {
      throw new Error('prompt failed');
      yield {
        type: 'agent_start',
      } as import('@earendil-works/pi-coding-agent').AgentSessionEvent;
    });

    const registry = {
      getOrCreate: vi.fn(async () => ({ isStreaming: false }) as AgentSession),
    } as unknown as SurfaceSessionRegistry;

    const service = createSurfaceRespondService({ registry });
    const events = await collectEvents(service, {
      user_id: 'web-user',
      message: 'hello',
    });

    expect(events).toEqual([
      {
        type: 'error',
        request_id: context.requestId,
        code: 'agent_error',
        message: 'prompt failed',
      },
    ]);
  });
});
