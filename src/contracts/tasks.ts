import { z } from 'zod';

import type { TaskListRecord } from '../queue/taskTypes.js';
import { TaskStatusSchema } from '../queue/taskTypes.js';

const DEFAULT_HTTP_STATUSES = ['pending', 'running'] as const;

/** Splits comma-separated or repeated query values into a status array. */
function parseStatusQuery(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export const ListTasksQuerySchema = z
  .object({
    /** Ignored: identity comes from the access token. Accepted so pre-auth clients don't 400. */
    user_id: z.string().optional(),
    status: z.preprocess(
      parseStatusQuery,
      z.array(TaskStatusSchema).min(1).optional(),
    ),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    /**
     * ISO-8601 lower bound for finished tasks: completed/failed rows that
     * finished earlier are excluded. Active rows are unaffected.
     * Normalized to UTC `toISOString()` so SQLite string compares match stored values.
     */
    completed_after: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .transform((query) => ({
    statuses: query.status ?? [...DEFAULT_HTTP_STATUSES],
    limit: query.limit ?? 100,
    completedAfter:
      query.completed_after === undefined
        ? undefined
        : new Date(query.completed_after).toISOString(),
  }));

/** A validated list query with the authenticated user id attached. */
export type ParsedListTasksQuery = z.infer<typeof ListTasksQuerySchema> & {
  userId: string;
};

export const TaskSummarySchema = z
  .object({
    id: z.string(),
    description: z.string(),
    status: TaskStatusSchema,
    created_at: z.string(),
    updated_at: z.string(),
    retry_count: z.number().int().nonnegative(),
    result: z.string().nullable(),
    error_message: z.string().nullable(),
    /** ISO timestamp of the completed/failed transition; null while active. */
    completed_at: z.string().nullable(),
  })
  .strict();

export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const ListTasksResponseSchema = z
  .object({
    tasks: z.array(TaskSummarySchema),
  })
  .strict();

export type ListTasksResponse = z.infer<typeof ListTasksResponseSchema>;

export const ListTasksValidationErrorSchema = z
  .object({
    code: z.literal('validation_error'),
    message: z.string(),
  })
  .strict();

/** Maps an internal list record to the public task summary shape. */
export function toTaskSummary(record: TaskListRecord): TaskSummary {
  return TaskSummarySchema.parse({
    id: record.id,
    description: record.description,
    status: record.status,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    retry_count: record.retryCount,
    result: record.result,
    error_message: record.errorMessage,
    completed_at: record.completedAt,
  });
}

export const DismissTaskErrorSchema = z
  .object({
    code: z.enum(['not_found', 'task_not_terminal']),
    message: z.string(),
  })
  .strict();

export type DismissTaskError = z.infer<typeof DismissTaskErrorSchema>;
