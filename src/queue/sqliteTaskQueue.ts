import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import type { AppLogger } from '../logging/types.js';
import { tasks } from './schema.js';
import type { WorkerTaskQueue } from './taskQueue.js';
import {
  EnqueueTaskInputSchema,
  TaskContextSchema,
  TaskRecordSchema,
  TaskListRecordSchema,
  type TaskListRecord,
  type TaskRecord,
  type TaskStatus,
} from './taskTypes.js';

export type SqliteTaskQueue = WorkerTaskQueue & {
  close(): void;
};

export type CreateSqliteTaskQueueOptions = {
  dbPath: string;
  migrationsFolder: string;
  log?: AppLogger;
};

/** Generates a unique task identifier. */
function createTaskId(): string {
  return `task_${randomBytes(8).toString('hex')}`;
}

type TaskListRow = Pick<
  typeof tasks.$inferSelect,
  | 'id'
  | 'description'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'retryCount'
  | 'result'
  | 'errorMessage'
>;

/** Maps a summary row to a validated list record without parsing context. */
function mapRowToTaskListRecord(row: TaskListRow): TaskListRecord {
  return TaskListRecordSchema.parse({
    id: row.id,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    retryCount: row.retryCount,
    result: row.result,
    errorMessage: row.errorMessage,
  });
}

type RunningTaskTransitionPatch = Pick<
  typeof tasks.$inferInsert,
  'status' | 'result' | 'errorMessage'
> & {
  retryCount?: number | SQL;
};

/** Returns an error when a running-task transition did not update exactly one row, else null. */
function runningTaskNotUpdatedError(
  taskId: string,
  changes: number,
): Error | null {
  return changes !== 1
    ? new Error(`task ${taskId} is not running or does not exist`)
    : null;
}

/** Maps a Drizzle row to a validated task record. */
function mapRowToTaskRecord(row: typeof tasks.$inferSelect): TaskRecord {
  return TaskRecordSchema.parse({
    id: row.id,
    userId: row.userId,
    description: row.description,
    context: TaskContextSchema.parse(JSON.parse(row.context)),
    sessionId: row.sessionId,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    retryCount: row.retryCount,
    result: row.result,
    errorMessage: row.errorMessage,
  });
}

/** Opens the SQLite task queue, runs migrations, and returns the queue API. */
export async function createSqliteTaskQueue(
  options: CreateSqliteTaskQueueOptions,
): Promise<SqliteTaskQueue> {
  await mkdir(dirname(options.dbPath), { recursive: true });

  const sqlite = new Database(options.dbPath);
  const db = drizzle(sqlite);

  migrate(db, { migrationsFolder: options.migrationsFolder });

  /** Selects the oldest pending task and flips it to running inside one transaction. */
  const claimNextPendingSync = sqlite.transaction((): TaskRecord | null => {
    const rows = db
      .select()
      .from(tasks)
      .where(eq(tasks.status, 'pending'))
      .orderBy(asc(tasks.updatedAt), asc(tasks.id))
      .limit(1)
      .all();

    const row = rows[0];
    if (!row) {
      return null;
    }

    const now = new Date().toISOString();
    const changes = db
      .update(tasks)
      .set({ status: 'running', updatedAt: now })
      .where(and(eq(tasks.id, row.id), eq(tasks.status, 'pending')))
      .run().changes;

    if (changes !== 1) {
      return null;
    }

    return mapRowToTaskRecord({ ...row, status: 'running', updatedAt: now });
  });

  /** Applies a guarded running→* transition, asserts exactly one row updated, and logs. */
  function transitionRunningTask(
    taskId: string,
    patch: RunningTaskTransitionPatch,
    logMeta: { event: string; message: string },
  ): Promise<void> {
    const now = new Date().toISOString();
    const changes = db
      .update(tasks)
      .set({ ...patch, updatedAt: now })
      .where(and(eq(tasks.id, taskId), eq(tasks.status, 'running')))
      .run().changes;

    const notUpdated = runningTaskNotUpdatedError(taskId, changes);
    if (notUpdated) {
      return Promise.reject(notUpdated);
    }

    options.log?.info(
      { event: logMeta.event, task_id: taskId },
      logMeta.message,
    );

    return Promise.resolve();
  }

  const queue: SqliteTaskQueue = {
    close() {
      sqlite.close();
    },

    async enqueue(input) {
      const parsed = EnqueueTaskInputSchema.parse(input);
      const now = new Date().toISOString();
      const id = createTaskId();

      const row = {
        id,
        userId: parsed.userId,
        description: parsed.description,
        context: JSON.stringify(parsed.context),
        sessionId: parsed.sessionId ?? null,
        status: 'pending' satisfies TaskStatus,
        createdAt: now,
        updatedAt: now,
        retryCount: 0,
        result: null,
        errorMessage: null,
      };

      await db.insert(tasks).values(row);

      const record = mapRowToTaskRecord(row);

      options.log?.info(
        {
          event: 'task.enqueued',
          task_id: record.id,
          user_id: record.userId,
          session_id: record.sessionId ?? undefined,
        },
        'task enqueued',
      );
      options.log?.debug(
        {
          event: 'task.enqueued',
          task_id: record.id,
          description: record.description,
          context: record.context,
        },
        'task enqueue details',
      );

      return record;
    },

    async getById(userId, taskId) {
      const rows = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
        .limit(1);

      const row = rows[0];
      return row ? mapRowToTaskRecord(row) : null;
    },

    async listByUser(userId, options) {
      const limit = options.limit ?? 100;
      const rows = await db
        .select({
          id: tasks.id,
          description: tasks.description,
          status: tasks.status,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
          retryCount: tasks.retryCount,
          result: tasks.result,
          errorMessage: tasks.errorMessage,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.userId, userId),
            inArray(tasks.status, options.statuses),
          ),
        )
        .orderBy(asc(tasks.createdAt), asc(tasks.id))
        .limit(limit);

      return rows.map((row) => mapRowToTaskListRecord(row));
    },

    claimNextPending() {
      const record = claimNextPendingSync();
      if (!record) {
        return Promise.resolve(null);
      }

      options.log?.info(
        {
          event: 'task.claimed',
          task_id: record.id,
          user_id: record.userId,
          session_id: record.sessionId ?? undefined,
        },
        'task claimed',
      );

      return Promise.resolve(record);
    },

    markCompleted(taskId, result) {
      return transitionRunningTask(
        taskId,
        { status: 'completed', result },
        { event: 'task.completed', message: 'task completed' },
      );
    },

    markFailed(taskId, errorMessage) {
      return transitionRunningTask(
        taskId,
        { status: 'failed', errorMessage },
        { event: 'task.failed', message: 'task failed' },
      );
    },

    requeue(taskId, errorMessage) {
      return transitionRunningTask(
        taskId,
        {
          status: 'pending',
          retryCount: sql`${tasks.retryCount} + 1`,
          errorMessage,
        },
        { event: 'task.requeued', message: 'task requeued' },
      );
    },

    requeueStuckRunning() {
      const now = new Date().toISOString();
      const changes = db
        .update(tasks)
        .set({ status: 'pending', updatedAt: now })
        .where(eq(tasks.status, 'running'))
        .run().changes;

      if (changes > 0) {
        options.log?.info(
          { event: 'task.stuck_requeued', count: changes },
          'stuck running tasks requeued',
        );
      }

      return Promise.resolve(changes);
    },
  };

  return queue;
}
