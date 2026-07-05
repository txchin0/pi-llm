import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';

import {
  createChildLogger,
  logRespondSseEvent,
  type AppLogger,
} from '../../logging/index.js';
import type { RespondController } from '../../respond/respondController.js';
import { requireUserId } from '../authenticate.js';
import { writeSseEvent } from '../writeSseEvent.js';

type RegisterRespondRouteOptions = {
  controller: RespondController;
  authenticate: preHandlerHookHandler;
  logger: AppLogger;
};

/** Hijacks the reply and sets unbuffered SSE response headers. */
function writeSseHeaders(reply: FastifyReply): void {
  // @fastify/cors runs as an onRequest hook (default), so it has already called
  // reply.header('access-control-allow-origin', ...) by the time we get here. Hijacking
  // bypasses reply.send, so those headers must be copied into writeHead manually or the
  // stream ships without CORS. Keep this filter narrow (access-control-* + vary) — do NOT
  // broaden it, or it would clobber the content-type set below.
  const corsHeaders: Record<string, string | number | string[]> = {};
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if ((name.startsWith('access-control-') || name === 'vary') && value !== undefined) {
      corsHeaders[name] = value;
    }
  }

  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    ...corsHeaders,
  });
}

/** Ends the raw response stream if it is still open. */
function finalizeSseResponse(reply: FastifyReply): void {
  if (!reply.raw.writableEnded) {
    reply.raw.end();
  }
}

/** Registers `POST /v1/respond` and streams controller SSE events to the client. */
export function registerRespondRoute(
  app: FastifyInstance,
  options: RegisterRespondRouteOptions,
): void {
  app.post('/v1/respond', {
    preHandler: options.authenticate,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;
    const startedAtMs = Date.now();
    const log = createChildLogger(options.logger, {
      component: 'respond.route',
      request_id: requestId,
    });

    log.debug({ event: 'respond.request.received' }, 'respond request received');

    writeSseHeaders(reply);

    let requestError: unknown;

    try {
      for await (const event of options.controller.handle(request.body, {
        userId: requireUserId(request),
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
