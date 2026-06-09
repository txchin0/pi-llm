import type { RespondSseEvent } from '../contracts/respond.js';

/** Formats a respond SSE event as a wire frame (`event:` + `data:` lines). */
export function writeSseEvent(event: RespondSseEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
