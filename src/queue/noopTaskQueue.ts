import type { TaskQueue } from './sqliteTaskQueue.js';

/** Returns empty lists; used when buildServer() runs without a real queue in tests. */
export const noopTaskQueue: TaskQueue = {
  async enqueue() {
    throw new Error('noopTaskQueue does not support enqueue');
  },

  async getById() {
    return null;
  },

  async listPending() {
    return [];
  },

  async listByUser() {
    return [];
  },
};
