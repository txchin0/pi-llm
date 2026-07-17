import type { TaskQueue, UserTaskQueue } from '../../src/queue/taskQueue.js';

/** Minimal {@link TaskQueue} stub for surface-path unit tests. */
export function createMockTaskQueue(
  overrides: Partial<TaskQueue> = {},
): TaskQueue {
  return {
    enqueue() {
      return Promise.reject(new Error('not used'));
    },
    getById() {
      return Promise.resolve(null);
    },
    listByUser() {
      return Promise.resolve([]);
    },
    ...overrides,
  };
}

/** Minimal {@link UserTaskQueue} stub for HTTP task-route tests. */
export function createMockUserTaskQueue(
  overrides: Partial<UserTaskQueue> = {},
): UserTaskQueue {
  return {
    ...createMockTaskQueue(overrides),
    dismiss() {
      return Promise.resolve('not_found');
    },
    ...overrides,
  };
}
