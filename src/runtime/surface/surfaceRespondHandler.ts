import type { RespondHandler, RespondContext } from '../respondHandoff.js';
import type { RespondRequest, RespondSseEvent } from '../../contracts/respond.js';
import type { AppLogger } from '../../logging/index.js';
import { enrichUserMessage } from './enrichUserMessage.js';
import {
  createPiEventMapperState,
  mapPiEventForRequest,
} from './mapPiEventToRespond.js';
import type { SurfaceSessionRegistry } from './surfaceSessionRegistry.js';

export type SurfaceRespondHandlerDependencies = {
  registry: SurfaceSessionRegistry;
  now?: () => string;
  logger?: AppLogger;
};

/** Waits one event-loop tick so queued Pi events can be drained. */
function waitForNextTick(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Bridges Pi session events into respond SSE events while `prompt()` runs. */
async function* streamSurfacePrompt(
  request: RespondRequest,
  context: RespondContext,
  dependencies: SurfaceRespondHandlerDependencies,
): AsyncGenerator<RespondSseEvent> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const log = context.logger ?? dependencies.logger;

  const session = await dependencies.registry.getOrCreate(
    context.sessionId,
    request.user_id,
  );

  if (session.isStreaming) {
    yield {
      type: 'error',
      request_id: context.requestId,
      code: 'session_busy',
      message: 'Surface session is already processing a request.',
    };
    return;
  }

  const mapperState = createPiEventMapperState();
  const queue: RespondSseEvent[] = [];
  let done = false;
  let promptError: unknown;

  const mapperContext = {
    requestId: context.requestId,
    sessionId: context.sessionId,
    showThinking: request.show_thinking === true,
    completedAt: now,
  };

  const unsubscribe = session.subscribe((event) => {
    queue.push(
      ...mapPiEventForRequest(event, {
        request,
        context: mapperContext,
        state: mapperState,
      }),
    );
  });

  const promptPromise = session
    .prompt(enrichUserMessage(request.message, now))
    .catch((error: unknown) => {
      promptError = error;
    })
    .finally(() => {
      done = true;
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

      await waitForNextTick();
    }

    await promptPromise;

    if (promptError !== undefined) {
      throw promptError;
    }
  } catch (error) {
    log?.error(
      {
        event: 'agent.error',
        err: error,
      },
      'surface agent prompt failed',
    );

    yield {
      type: 'error',
      request_id: context.requestId,
      code: 'agent_error',
      message:
        error instanceof Error
          ? error.message
          : 'Surface agent failed to complete the request.',
    };
  } finally {
    unsubscribe();
  }
}

/** Creates the production respond handler backed by Pi surface sessions. */
export function createSurfaceRespondHandler(
  dependencies: SurfaceRespondHandlerDependencies,
): RespondHandler {
  return {
    handle(request, context) {
      return streamSurfacePrompt(request, context, dependencies);
    },
  };
}
