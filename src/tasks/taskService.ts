import {
  toTaskSummary,
  type ListTasksResponse,
  type ParsedListTasksQuery,
} from '../contracts/tasks.js';
import type {
  DismissTaskOutcome,
  UserTaskQueue,
} from '../queue/taskQueue.js';

export type TaskServiceDependencies = {
  taskQueue: UserTaskQueue;
};

/** Application service for listing and dismissing user tasks. */
export interface TaskService {
  listTasks(query: ParsedListTasksQuery): Promise<ListTasksResponse>;
  dismissTask(userId: string, taskId: string): Promise<DismissTaskOutcome>;
}

/** Creates a task service backed by the user-facing task queue port. */
export function createTaskService(
  dependencies: TaskServiceDependencies,
): TaskService {
  return {
    async listTasks(query) {
      const records = await dependencies.taskQueue.listByUser(query.userId, {
        statuses: query.statuses,
        limit: query.limit,
        ...(query.completedAfter !== undefined
          ? { completedAfter: query.completedAfter }
          : {}),
      });

      return {
        tasks: records.map((record) => toTaskSummary(record)),
      };
    },

    async dismissTask(userId, taskId) {
      return dependencies.taskQueue.dismiss(userId, taskId);
    },
  };
}
