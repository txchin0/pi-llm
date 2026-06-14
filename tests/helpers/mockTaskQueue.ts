import type { TaskQueue } from '../../src/queue/taskQueue.js';

/** Minimal {@link TaskQueue} stub for surface-path unit tests. */
export function createMockTaskQueue(
  overrides: Partial<TaskQueue> = {},
): TaskQueue {
  return {
    async enqueue() {
      throw new Error('not used');
    },
    async getById() {
      return null;
    },
    async listByUser() {
      return [];
    },
    ...overrides,
  };
}
