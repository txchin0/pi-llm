import type { RespondService } from '../../src/respond/respondService.js';

/** Minimal {@link RespondService} stub that yields no events. */
export function createStubRespondService(
  overrides: Partial<RespondService> = {},
): RespondService {
  return {
    async *handleTurn() {},
    ...overrides,
  };
}
