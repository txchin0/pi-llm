import { describe, expect, it, vi } from 'vitest';

import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import { runAgentPrompt } from '../../src/agent/runAgentPrompt.js';

function createMockSession(
  handlers: {
    subscribe?: (cb: (event: AgentSessionEvent) => void) => () => void;
    prompt?: (message: string, options?: { signal?: AbortSignal }) => Promise<void>;
    abort?: () => Promise<void>;
    isStreaming?: boolean;
  } = {},
): AgentSession {
  return {
    isStreaming: handlers.isStreaming ?? false,
    subscribe: handlers.subscribe ?? (() => () => {}),
    prompt: handlers.prompt ?? (() => Promise.resolve()),
    abort: handlers.abort ?? (() => Promise.resolve()),
  } as AgentSession;
}

async function collectEvents(
  session: AgentSession,
  message: string,
  options?: { signal?: AbortSignal },
): Promise<AgentSessionEvent[]> {
  const events: AgentSessionEvent[] = [];
  for await (const event of runAgentPrompt(session, message, options)) {
    events.push(event);
  }
  return events;
}

describe('runAgentPrompt', () => {
  it('yields raw events in subscribe order and unsubscribes on completion', async () => {
    let unsubscribed = false;
    const session = createMockSession({
      subscribe(cb) {
        cb({ type: 'agent_start' });
        cb({
          type: 'agent_end',
          messages: [],
          willRetry: false,
        });
        return () => {
          unsubscribed = true;
        };
      },
    });

    const events = await collectEvents(session, 'hello');

    expect(events.map((event) => event.type)).toEqual(['agent_start', 'agent_end']);
    expect(unsubscribed).toBe(true);
  });

  it('passes the message to session.prompt', async () => {
    const prompt = vi.fn(() => Promise.resolve());
    const session = createMockSession({ prompt });

    await collectEvents(session, 'test message');

    expect(prompt).toHaveBeenCalledWith('test message');
  });

  it('re-throws prompt errors after draining the queue', async () => {
    const session = createMockSession({
      subscribe(cb) {
        cb({ type: 'agent_start' });
        return () => {};
      },
      prompt: () => Promise.reject(new Error('prompt failed')),
    });

    await expect(collectEvents(session, 'hello')).rejects.toThrow('prompt failed');
  });

  it('aborts the session when the signal fires', async () => {
    const abort = vi.fn(() => Promise.resolve());
    const controller = new AbortController();
    const session = createMockSession({
      subscribe() {
        return () => {};
      },
      prompt: () =>
        new Promise<void>(() => {
          controller.abort();
        }),
      abort,
    });

    await expect(
      collectEvents(session, 'hello', { signal: controller.signal }),
    ).rejects.toThrow();

    expect(abort).toHaveBeenCalled();
  });

  it('delivers events without setImmediate polling', async () => {
    const setImmediateSpy = vi.spyOn(globalThis, 'setImmediate');

    const session = createMockSession({
      subscribe(cb) {
        cb({ type: 'agent_start' });
        return () => {};
      },
    });

    await collectEvents(session, 'hello');

    expect(setImmediateSpy).not.toHaveBeenCalled();
    setImmediateSpy.mockRestore();
  });
});
