import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { RequestId } from '../../contracts/respond.js';
import { RespondRequestSchema } from '../../contracts/respond.js';
import {
  createChildLogger,
  logRespondSseEvent,
  type AppLogger,
} from '../../logging/index.js';
import type { RespondOrchestrator } from '../../runtime/respondOrchestrator.js';
import { writeSseEvent } from '../writeSseEvent.js';

type RegisterRespondRouteOptions = {
  orchestrator: RespondOrchestrator;
  logger: AppLogger;
};

/** Returns the parsed request body when valid, otherwise the raw body for orchestrator validation. */
function prepareRespondPayload(request: FastifyRequest): unknown {
  const parsedRequest = RespondRequestSchema.safeParse(request.body);
  return parsedRequest.success ? parsedRequest.data : request.body;
}

/** Hijacks the reply and sets unbuffered SSE response headers. */
function writeSseHeaders(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
}

/** Ends the raw response stream if it is still open. */
function finalizeSseResponse(reply: FastifyReply): void {
  if (!reply.raw.writableEnded) {
    reply.raw.end();
  }
}

/** Registers `POST /v1/respond` and streams orchestrator SSE events to the client. */
export function registerRespondRoute(
  app: FastifyInstance,
  options: RegisterRespondRouteOptions,
): void {
  app.post('/v1/respond', async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = prepareRespondPayload(request);
    const requestId = request.id as RequestId;
    const startedAtMs = Date.now();
    const log = createChildLogger(options.logger, {
      component: 'respond.route',
      request_id: requestId,
    });

    log.debug({ event: 'respond.request.received' }, 'respond request received');

    writeSseHeaders(reply);

    let requestError: unknown;

    try {
      for await (const event of options.orchestrator.handle(payload, {
        requestId,
        logger: log,
      })) {
        logRespondSseEvent(log, event);
        reply.raw.write(writeSseEvent(event));
      }
    } catch (error) {
      requestError = error;
      log.error(
        {
          event: 'respond.request.failed',
          err: error,
          duration_ms: Date.now() - startedAtMs,
        },
        'respond request failed',
      );
      throw error;
    } finally {
      if (requestError === undefined) {
        log.info(
          {
            event: 'respond.request.completed',
            duration_ms: Date.now() - startedAtMs,
          },
          'respond request completed',
        );
      }

      finalizeSseResponse(reply);
    }
  });
}
