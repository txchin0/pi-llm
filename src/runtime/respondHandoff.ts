import type {
  RequestId,
  RespondRequest,
  RespondSseEvent,
  SessionId,
} from '../contracts/respond.js';
import type { AppLogger } from '../logging/index.js';

/** Per-request identifiers passed from the orchestrator to the handoff handler. */
export type RespondContext = {
  requestId: RequestId;
  sessionId: SessionId;
  startedAt: string;
  logger?: AppLogger;
};

/** Executes validated respond requests and yields SSE events after `start`. */
export interface RespondHandler {
  /** Runs the request and streams any follow-up SSE events. */
  handle(
    request: RespondRequest,
    context: RespondContext,
  ): AsyncIterable<RespondSseEvent>;
}
