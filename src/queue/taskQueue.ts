import type {
  EnqueueTaskInput,
  TaskListRecord,
  TaskRecord,
  TaskStatus,
} from './taskTypes.js';

export type ListTasksOptions = {
  statuses: TaskStatus[];
  limit?: number;
  /**
   * Canonical UTC ISO (`Date.toISOString()`) lower bound for terminal tasks:
   * completed/failed rows whose completedAt is older are excluded. Active rows
   * (completedAt null) always pass. Callers must normalize offsets/ms first.
   */
  completedAfter?: string;
};

/** Outcome of a user-initiated dismiss; 'dismissed' includes the idempotent repeat case. */
export type DismissTaskOutcome = 'dismissed' | 'not_found' | 'not_terminal';

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

/**
 * Extends {@link TaskQueue} with user-facing history mutations (HTTP dismiss).
 * Surface agents keep the narrower {@link TaskQueue} and never see dismiss.
 */
export type UserTaskQueue = TaskQueue & {
  /** Hides a finished (completed/failed) task from future lists for its owner. */
  dismiss(userId: string, taskId: string): Promise<DismissTaskOutcome>;
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
