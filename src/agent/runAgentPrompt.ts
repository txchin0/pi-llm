import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import type { RespondSseEvent } from '../contracts/respond.js';

export type AgentPromptMapper = (event: AgentSessionEvent) => RespondSseEvent[];

export type RunAgentPromptOptions = {
  mapEvent: AgentPromptMapper;
};

/** Subscribes to Pi session events, runs prompt(), and yields mapped SSE events until completion. */
export async function* runAgentPrompt(
  session: AgentSession,
  message: string,
  options: RunAgentPromptOptions,
): AsyncGenerator<RespondSseEvent> {
  const queue: RespondSseEvent[] = [];
  let done = false;
  let promptError: unknown;
  let resolveNext: (() => void) | null = null;

  const unsubscribe = session.subscribe((event) => {
    queue.push(...options.mapEvent(event));
    resolveNext?.();
    resolveNext = null;
  });

  const promptPromise = session
    .prompt(message)
    .catch((error: unknown) => {
      promptError = error;
    })
    .finally(() => {
      done = true;
      resolveNext?.();
      resolveNext = null;
    });

  try {
    while (!done || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift() as RespondSseEvent;
        continue;
      }

      if (done) {
        break;
      }

      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
    }

    await promptPromise;

    if (promptError !== undefined) {
      throw promptError;
    }
  } finally {
    unsubscribe();
  }
}
