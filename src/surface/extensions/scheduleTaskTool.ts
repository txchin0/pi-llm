import { Type } from 'typebox';
import { z } from 'zod';

import { extractRecentTurns } from '../../queue/extractRecentTurns.js';
import type { TaskQueue } from '../../queue/sqliteTaskQueue.js';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { AppLogger } from '../../logging/types.js';

const scheduleTaskDescriptionSchema = z.string().trim().min(1);

export const scheduleTaskParameters = Type.Object({
  description: Type.String({
    description: 'Free-form text describing what background work should be done',
  }),
});

export type ScheduleTaskToolDependencies = {
  taskQueue: TaskQueue;
  userId: string;
  sessionId: string;
  contextTurnLimit: number;
  log?: AppLogger;
};

/** Validates and enqueues a deferred task from the surface agent tool call. */
export async function executeScheduleTask(
  deps: ScheduleTaskToolDependencies,
  params: { description: string },
  ctx: ExtensionContext,
) {
  const parsedDescription = scheduleTaskDescriptionSchema.safeParse(params.description);
  if (!parsedDescription.success) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Task description must be a non-empty string.',
        },
      ],
      details: {},
    };
  }

  const context = extractRecentTurns(ctx.sessionManager, deps.contextTurnLimit);

  const record = await deps.taskQueue.enqueue({
    userId: deps.userId,
    sessionId: deps.sessionId,
    description: parsedDescription.data,
    context,
  });

  deps.log?.debug(
    {
      event: 'tool.schedule_task',
      task_id: record.id,
      tool_name: 'schedule_task',
    },
    'schedule_task completed',
  );

  return {
    content: [
      {
        type: 'text' as const,
        text: `Task queued (id: ${record.id}): ${record.description}`,
      },
    ],
    details: { task_id: record.id },
  };
}
