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
 * Task queue port for enqueue and query operations used by the surface agent.
 * Methods are async for adapter consistency; the SQLite implementation uses
 * synchronous better-sqlite3 internally.
 */
export type TaskQueue = {
  enqueue(input: EnqueueTaskInput): Promise<TaskRecord>;
  getById(userId: string, taskId: string): Promise<TaskRecord | null>;
  listByUser(userId: string, options: ListTasksOptions): Promise<TaskListRecord[]>;
};

/** Extends {@link TaskQueue} with worker lifecycle transitions. */
export type WorkerTaskQueue = TaskQueue & {
  /** Atomically claims the oldest pending task (updatedAt, then id) and sets it to running. */
  claimNextPending(): Promise<TaskRecord | null>;
  /** Marks a running task completed and stores the worker result summary. */
  markCompleted(taskId: string, result: string): Promise<void>;
  /** Marks a running task failed with a terminal error message. */
  markFailed(taskId: string, errorMessage: string): Promise<void>;
  /** Returns a running task to pending, increments retryCount, and stores the error. */
  requeue(taskId: string, errorMessage: string): Promise<void>;
  /** Resets orphaned running tasks to pending after a crash; returns the count updated. */
  requeueStuckRunning(): Promise<number>;
};
