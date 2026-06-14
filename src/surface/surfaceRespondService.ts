import { runAgentPrompt } from '../agent/runAgentPrompt.js';
import type { AppLogger } from '../logging/index.js';
import type { RespondContext, RespondService } from '../respond/respondService.js';
import { enrichUserMessage, formatNowInTimezone } from './util/enrichUserMessage.js';
import {
  createPiEventMapperState,
  mapPiEventForRequest,
} from './mapPiEventToRespond.js';
import type { SurfaceSessionRegistry } from './surfaceSessionRegistry.js';

export type SurfaceRespondServiceDependencies = {
  registry: SurfaceSessionRegistry;
  now?: () => string;
  logger?: AppLogger;
};

/** Creates the production respond service backed by Pi surface sessions. */
export function createSurfaceRespondService(
  dependencies: SurfaceRespondServiceDependencies,
): RespondService {
  return {
    async *handleTurn(request, context) {
      const now = dependencies.now ?? (() => formatNowInTimezone());
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
      const mapperContext = {
        requestId: context.requestId,
        sessionId: context.sessionId,
        completedAt: now,
      };

      try {
        for await (const event of runAgentPrompt(
          session,
          enrichUserMessage(request.message, now),
        )) {
          yield* mapPiEventForRequest(event, {
            request,
            context: mapperContext,
            state: mapperState,
          });
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
      }
    },
  };
}
