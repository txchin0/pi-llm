import type { RespondService } from './respondService.js';

/** Yields no events; used when buildServer() runs without a production service. */
export const noopRespondService: RespondService = {
  async *handleTurn() {},
};
