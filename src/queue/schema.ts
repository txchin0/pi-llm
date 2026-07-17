import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Persistent task queue rows consumed by the future worker agent. */
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  description: text('description').notNull(),
  context: text('context').notNull(),
  sessionId: text('session_id'),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  retryCount: integer('retry_count').notNull().default(0),
  result: text('result'),
  errorMessage: text('error_message'),
  /** Set on the terminal completed/failed transition; cleared on requeue. */
  completedAt: text('completed_at'),
  /** Set when the user dismisses a finished task; dismissed rows are hidden from list queries. */
  dismissedAt: text('dismissed_at'),
}, (table) => [
  index('tasks_user_id_created_at_idx').on(table.userId, table.createdAt),
]);
