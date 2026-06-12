import type { TaskQueue } from './taskQueue.js';

/** Returns empty lists; used when buildServer() runs without a real queue in tests. */
export const noopTaskQueue: TaskQueue = {
  async enqueue() {
    throw new Error('noopTaskQueue does not support enqueue');
  },

  async getById() {
    return null;
  },

  async listByUser() {
    return [];
  },
};
