import type { TaskQueue } from './taskQueue.js';

/** Returns empty lists; used when buildServer() runs without a real queue in tests. */
export const noopTaskQueue: TaskQueue = {
  enqueue() {
    return Promise.reject(new Error('noopTaskQueue does not support enqueue'));
  },

  getById() {
    return Promise.resolve(null);
  },

  listByUser() {
    return Promise.resolve([]);
  },
};
