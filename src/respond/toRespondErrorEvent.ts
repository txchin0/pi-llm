import type { RequestId, RespondErrorEvent } from '../contracts/respond.js';

/** Builds a terminal SSE `error` event for one respond request. */
export function toRespondErrorEvent(
  requestId: RequestId,
  code: string,
  message: string,
): RespondErrorEvent {
  return {
    type: 'error',
    request_id: requestId,
    code,
    message,
  };
}

/** Builds the SSE error event returned when request validation fails. */
export function toValidationErrorEvent(requestId: RequestId): RespondErrorEvent {
  return toRespondErrorEvent(
    requestId,
    'validation_error',
    'Request body must include message and an optional server-issued session_id.',
  );
}
