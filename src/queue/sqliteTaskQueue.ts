import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import type { AppLogger } from '../logging/types.js';
import { tasks } from './schema.js';
import {
  EnqueueTaskInputSchema,
  TaskContextSchema,
  TaskRecordSchema,
  TaskListRecordSchema,
  type EnqueueTaskInput,
  type TaskListRecord,
  type TaskRecord,
  type TaskStatus,
} from './taskTypes.js';

export type ListTasksOptions = {
  statuses: TaskStatus[];
  limit?: number;
};

export type TaskQueue = {
  enqueue(input: EnqueueTaskInput): Promise<TaskRecord>;
  getById(userId: string, taskId: string): Promise<TaskRecord | null>;
  listPending(userId: string, limit?: number): Promise<TaskListRecord[]>;
  listByUser(userId: string, options: ListTasksOptions): Promise<TaskListRecord[]>;
};

export type SqliteTaskQueue = TaskQueue & {
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

    async listPending(userId, limit = 100) {
      return queue.listByUser(userId, { statuses: ['pending'], limit });
    },
  };

  return queue;
}
