import { z } from 'zod';

import type { TaskListRecord } from '../queue/taskTypes.js';
import { TaskStatusSchema } from '../queue/taskTypes.js';
import { UserIdSchema } from './respond.js';

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
    user_id: UserIdSchema,
    status: z.preprocess(
      parseStatusQuery,
      z.array(TaskStatusSchema).min(1).optional(),
    ),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict()
  .transform((query) => ({
    userId: query.user_id,
    statuses: query.status ?? [...DEFAULT_HTTP_STATUSES],
    limit: query.limit ?? 100,
  }));

export type ParsedListTasksQuery = z.infer<typeof ListTasksQuerySchema>;

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
  });
}
