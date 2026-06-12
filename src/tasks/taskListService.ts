import {
  toTaskSummary,
  type ListTasksResponse,
  type ParsedListTasksQuery,
} from '../contracts/tasks.js';
import type { TaskQueue } from '../queue/taskQueue.js';

export type TaskListServiceDependencies = {
  taskQueue: TaskQueue;
};

/** Lists task summaries for a validated query. */
export interface TaskListService {
  listTasks(query: ParsedListTasksQuery): Promise<ListTasksResponse>;
}

/** Creates a task list service backed by the task queue port. */
export function createTaskListService(
  dependencies: TaskListServiceDependencies,
): TaskListService {
  return {
    async listTasks(query) {
      const records = await dependencies.taskQueue.listByUser(query.userId, {
        statuses: query.statuses,
        limit: query.limit,
      });

      return {
        tasks: records.map((record) => toTaskSummary(record)),
      };
    },
  };
}
