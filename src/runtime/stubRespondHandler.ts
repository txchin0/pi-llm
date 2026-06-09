import type { RespondHandler } from './respondHandoff.js';

/** No-op handoff placeholder until the Pi surface agent is wired in. */
export const stubRespondHandler: RespondHandler = {
  /** Accepts the handoff and yields no events. */
  async *handle() {},
};
