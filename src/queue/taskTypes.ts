import { z } from 'zod';

export const TaskStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

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
});

export type TaskListRecord = z.infer<typeof TaskListRecordSchema>;
