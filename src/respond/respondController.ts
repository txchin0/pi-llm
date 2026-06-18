import { randomBytes } from 'node:crypto';

import type { RequestId, RespondSseEvent, SessionId } from '../contracts/respond.js';
import { RespondRequestSchema } from '../contracts/respond.js';
import {
  createChildLogger,
  createRootLogger,
  logInboundMessage,
  type AppLogger,
} from '../logging/index.js';
import { noopRespondService } from './noopRespondService.js';
import type { RespondService } from './respondService.js';
import {
  toRespondErrorEvent,
  toValidationErrorEvent,
} from './toRespondErrorEvent.js';

export type RespondControllerDependencies = {
  service?: RespondService;
  logger?: AppLogger;
  now?: () => string;
  requestIdFactory?: () => RequestId;
  sessionIdFactory?: () => SessionId;
};

/** Generates a `req_`-prefixed request id. */
function defaultRequestIdFactory(): RequestId {
  return `req_${randomBytes(8).toString('hex')}`;
}

/** Generates a `sess_`-prefixed session id for first-turn requests. */
function defaultSessionIdFactory(): SessionId {
  return `sess_${randomBytes(8).toString('hex')}`;
}

type HandleRequestOptions = {
  requestId?: RequestId;
  logger?: AppLogger;
};

/** Validates inbound respond requests, emits `start`, then delegates to a service. */
export class RespondController {
  private readonly service: RespondService;
  private readonly logger: AppLogger;
  private readonly now: () => string;
  private readonly requestIdFactory: () => RequestId;
  private readonly sessionIdFactory: () => SessionId;

  /** Creates a controller with optional clock, id factories, and respond service. */
  constructor(dependencies: RespondControllerDependencies = {}) {
    this.service = dependencies.service ?? noopRespondService;
    this.logger = dependencies.logger ?? createRootLogger();
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.requestIdFactory =
      dependencies.requestIdFactory ?? defaultRequestIdFactory;
    this.sessionIdFactory =
      dependencies.sessionIdFactory ?? defaultSessionIdFactory;
  }

  /**
   * Validates `rawRequest`, yields `start` (or `validation_error`), then
   * streams any events from the configured respond service.
   */
  async *handle(
    rawRequest: unknown,
    options: HandleRequestOptions = {},
  ): AsyncGenerator<RespondSseEvent> {
    const requestId = options.requestId ?? this.requestIdFactory();
    const baseLogger = options.logger ?? this.logger;
    const log = createChildLogger(baseLogger, {
      component: 'respond.controller',
      request_id: requestId,
    });
    const validation = RespondRequestSchema.safeParse(rawRequest);

    if (!validation.success) {
      log.warn(
        {
          event: 'respond.validation.failed',
        },
        'respond request validation failed',
      );
      yield toValidationErrorEvent(requestId);
      return;
    }

    const request = validation.data;
    const startedAt = this.now();
    const sessionId = request.session_id ?? this.sessionIdFactory();
    const requestLog = createChildLogger(log, {
      component: 'respond.controller',
      session_id: sessionId,
      user_id: request.user_id,
    });

    logInboundMessage(requestLog, { message: request.message });

    requestLog.info(
      {
        event: 'respond.request.started',
        started_at: startedAt,
      },
      'respond request started',
    );

    yield {
      type: 'start',
      request_id: requestId,
      user_id: request.user_id,
      session_id: sessionId,
      started_at: startedAt,
    };

    try {
      yield* this.service.handleTurn(request, {
        requestId,
        sessionId,
        startedAt,
        logger: requestLog,
      });
    } catch (error) {
      requestLog.error(
        {
          event: 'respond.service.failed',
          err: error,
        },
        'respond service threw unexpectedly',
      );

      yield toRespondErrorEvent(
        requestId,
        'internal_error',
        error instanceof Error
          ? error.message
          : 'Respond service failed unexpectedly.',
      );
    }
  }
}
