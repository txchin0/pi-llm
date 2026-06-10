import { describe, expect, it, vi } from 'vitest';

import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import { runAgentPrompt } from '../../src/agent/runAgentPrompt.js';
import type { RespondSseEvent } from '../../src/contracts/respond.js';

function createMockSession(
  handlers: {
    subscribe?: (cb: (event: AgentSessionEvent) => void) => () => void;
    prompt?: (message: string) => Promise<void>;
    isStreaming?: boolean;
  } = {},
): AgentSession {
  return {
    isStreaming: handlers.isStreaming ?? false,
    subscribe: handlers.subscribe ?? (() => () => {}),
    prompt: handlers.prompt ?? (async () => {}),
  } as AgentSession;
}

async function collectEvents(
  session: AgentSession,
  message: string,
  mapEvent: (event: AgentSessionEvent) => RespondSseEvent[],
): Promise<RespondSseEvent[]> {
  const events: RespondSseEvent[] = [];
  for await (const event of runAgentPrompt(session, message, { mapEvent })) {
    events.push(event);
  }
  return events;
}

describe('runAgentPrompt', () => {
  it('yields mapped events in subscribe order and unsubscribes on completion', async () => {
    let unsubscribed = false;
    const session = createMockSession({
      subscribe(cb) {
        cb({ type: 'agent_start' } as AgentSessionEvent);
        cb({ type: 'agent_end' } as AgentSessionEvent);
        return () => {
          unsubscribed = true;
        };
      },
    });

    const events = await collectEvents(session, 'hello', (event) => [
      { type: 'delta', request_id: 'req_1', text: event.type },
    ]);

    expect(events).toEqual([
      { type: 'delta', request_id: 'req_1', text: 'agent_start' },
      { type: 'delta', request_id: 'req_1', text: 'agent_end' },
    ]);
    expect(unsubscribed).toBe(true);
  });

  it('passes the message to session.prompt', async () => {
    const prompt = vi.fn(async () => {});
    const session = createMockSession({ prompt });

    await collectEvents(session, 'test message', () => []);

    expect(prompt).toHaveBeenCalledWith('test message');
  });

  it('re-throws prompt errors after draining the queue', async () => {
    const session = createMockSession({
      subscribe(cb) {
        cb({ type: 'agent_start' } as AgentSessionEvent);
        return () => {};
      },
      prompt: async () => {
        throw new Error('prompt failed');
      },
    });

    await expect(
      collectEvents(session, 'hello', () => [
        { type: 'delta', request_id: 'req_1', text: 'x' },
      ]),
    ).rejects.toThrow('prompt failed');
  });

  it('delivers events without setImmediate polling', async () => {
    const setImmediateSpy = vi.spyOn(globalThis, 'setImmediate');

    const session = createMockSession({
      subscribe(cb) {
        cb({ type: 'agent_start' } as AgentSessionEvent);
        return () => {};
      },
    });

    await collectEvents(session, 'hello', () => [
      { type: 'delta', request_id: 'req_1', text: 'fast' },
    ]);

    expect(setImmediateSpy).not.toHaveBeenCalled();
    setImmediateSpy.mockRestore();
  });
});
