import type {
  RequestId,
  RespondRequest,
  RespondSseEvent,
  SessionId,
} from '../contracts/respond.js';
import type { AppLogger } from '../logging/index.js';

/** Per-request identifiers passed from the controller to the respond service. */
export type RespondContext = {
  requestId: RequestId;
  sessionId: SessionId;
  startedAt: string;
  logger?: AppLogger;
};

/** Executes one validated respond turn and streams SSE events after `start`. */
export interface RespondService {
  /**
   * Runs the request and streams any follow-up SSE events.
   *
   * Implementations must yield terminal `error` events for expected failures.
   * Unexpected throws after `start` are converted to `internal_error` by the
   * controller.
   */
  handleTurn(
    request: RespondRequest,
    context: RespondContext,
  ): AsyncIterable<RespondSseEvent>;
}
