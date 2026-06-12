import type {
  EnqueueTaskInput,
  TaskListRecord,
  TaskRecord,
  TaskStatus,
} from './taskTypes.js';

export type ListTasksOptions = {
  statuses: TaskStatus[];
  limit?: number;
};

/**
 * Task queue port for enqueue and query operations.
 * Methods are async for adapter consistency; the SQLite implementation uses
 * synchronous better-sqlite3 internally.
 */
export type TaskQueue = {
  enqueue(input: EnqueueTaskInput): Promise<TaskRecord>;
  getById(userId: string, taskId: string): Promise<TaskRecord | null>;
  listByUser(userId: string, options: ListTasksOptions): Promise<TaskListRecord[]>;
};
