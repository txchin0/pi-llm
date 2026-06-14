import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export type RunAgentPromptOptions = {
  signal?: AbortSignal;
};

/** Throws when the abort signal has fired. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('Agent prompt aborted');
}

/**
 * Subscribes to Pi session events, runs prompt(), and yields raw events until completion.
 * Callers own event interpretation (SSE mapping, worker summarization, error handling).
 * Optionally aborts the session when `signal` fires.
 */
export async function* runAgentPrompt(
  session: AgentSession,
  message: string,
  options: RunAgentPromptOptions = {},
): AsyncGenerator<AgentSessionEvent> {
  const { signal } = options;
  const queue: AgentSessionEvent[] = [];
  let done = false;
  let promptError: unknown;
  let resolveNext: (() => void) | null = null;

  const abortHandler = () => {
    void session.abort();
  };
  signal?.addEventListener('abort', abortHandler);

  const unsubscribe = session.subscribe((event) => {
    queue.push(event);
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
      throwIfAborted(signal);

      if (queue.length > 0) {
        yield queue.shift() as AgentSessionEvent;
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
    throwIfAborted(signal);

    if (promptError !== undefined) {
      throw promptError;
    }
  } finally {
    signal?.removeEventListener('abort', abortHandler);
    unsubscribe();
  }
}
