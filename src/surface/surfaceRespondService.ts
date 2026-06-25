import { runAgentPrompt } from '../agent/runAgentPrompt.js';
import type { AppLogger } from '../logging/index.js';
import { toRespondErrorEvent } from '../respond/toRespondErrorEvent.js';
import type { RespondService } from '../respond/respondService.js';
import { enrichUserMessage, formatNowInTimezone } from '../agent/piMessageText.js';
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

      try {
        const session = await dependencies.registry.getOrCreate(
          context.sessionId,
          request.user_id,
        );

        if (session.isStreaming) {
          yield toRespondErrorEvent(
            context.requestId,
            'session_busy',
            'Surface session is already processing a request.',
          );
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

          yield toRespondErrorEvent(
            context.requestId,
            'agent_error',
            error instanceof Error
              ? error.message
              : 'Surface agent failed to complete the request.',
          );
        }
      } catch (error) {
        log?.error(
          {
            event: 'surface.session.create_failed',
            err: error,
          },
          'surface session creation failed',
        );

        yield toRespondErrorEvent(
          context.requestId,
          'provider_error',
          error instanceof Error
            ? error.message
            : 'Surface agent is unavailable.',
        );
      }
    },
  };
}
