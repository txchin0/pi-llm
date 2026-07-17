import { z } from 'zod';

export const TaskStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/** Statuses that represent a finished task (eligible for dismiss / completedAt). */
export const TERMINAL_TASK_STATUSES = ['completed', 'failed'] as const satisfies readonly TaskStatus[];

export type TerminalTaskStatus = (typeof TERMINAL_TASK_STATUSES)[number];

/** Returns true when the status is completed or failed. Accepts raw DB strings. */
export function isTerminalTaskStatus(status: string): status is TerminalTaskStatus {
  return (TERMINAL_TASK_STATUSES as readonly string[]).includes(status);
}

export const ConversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;

export const TaskContextSchema = z.object({
  turns: z.array(ConversationTurnSchema),
});

export type TaskContext = z.infer<typeof TaskContextSchema>;

export const EnqueueTaskInputSchema = z.object({
  userId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1),
  context: TaskContextSchema,
});

export type EnqueueTaskInput = z.infer<typeof EnqueueTaskInputSchema>;

export const TaskRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  description: z.string(),
  context: TaskContextSchema,
  sessionId: z.string().nullable(),
  status: TaskStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  retryCount: z.number().int().nonnegative(),
  result: z.string().nullable(),
  errorMessage: z.string().nullable(),
  /** ISO timestamp of the terminal completed/failed transition; null while active. */
  completedAt: z.string().nullable(),
});

export type TaskRecord = z.infer<typeof TaskRecordSchema>;

/** Task fields exposed by list endpoints without conversation context. */
export const TaskListRecordSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: TaskStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  retryCount: z.number().int().nonnegative(),
  result: z.string().nullable(),
  errorMessage: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export type TaskListRecord = z.infer<typeof TaskListRecordSchema>;
