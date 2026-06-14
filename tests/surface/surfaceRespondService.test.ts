import { describe, expect, it, vi } from 'vitest';

import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import type { RespondSseEvent } from '../../src/contracts/respond.js';
import { createSurfaceRespondService } from '../../src/surface/surfaceRespondService.js';
import type { SurfaceSessionRegistry } from '../../src/surface/surfaceSessionRegistry.js';

const mockAgentEvent = {
  type: 'message_update',
  message: {} as never,
  assistantMessageEvent: {
    type: 'text_delta',
    contentIndex: 0,
    delta: 'from-runner',
    partial: {} as never,
  },
} as AgentSessionEvent;

vi.mock('../../src/agent/runAgentPrompt.js', () => ({
  runAgentPrompt: vi.fn(async function* () {
    await Promise.resolve();
    yield mockAgentEvent;
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

function createRegistry(session: AgentSession): SurfaceSessionRegistry {
  return {
    getOrCreate: vi.fn(() => Promise.resolve(session)),
  } as unknown as SurfaceSessionRegistry;
}

describe('createSurfaceRespondService', () => {
  it('returns session_busy when the session is already streaming', async () => {
    const service = createSurfaceRespondService({
      registry: createRegistry({ isStreaming: true } as AgentSession),
    });
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

    const service = createSurfaceRespondService({
      registry: createRegistry({ isStreaming: false } as AgentSession),
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
      await Promise.resolve();
      throw new Error('prompt failed');
      yield mockAgentEvent;
    });

    const service = createSurfaceRespondService({
      registry: createRegistry({ isStreaming: false } as AgentSession),
    });
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
