import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { parseDateOnly } from '../google/dateBounds.js';
import type { IntegrationContext } from '../types.js';
import {
  cancelledToolResult,
  formatGoogleToolError,
  resolveGoogleAccessToken,
  textToolResult,
} from '../google/toolRuntime.js';
import { summarizeSingleTask } from './taskSummaries.js';
import {
  createTask,
  deleteTask,
  findExistingOpenTask,
  updateTask,
} from './tasksClient.js';

const tasksWriteSchema = Type.Object({
  action: Type.Union(
    [Type.Literal('create'), Type.Literal('update'), Type.Literal('delete')],
    { description: 'Whether to create, update, or delete a task' },
  ),
  tasklistId: Type.String({ description: 'Task list id (required; from prior tasks_read results)' }),
  taskId: Type.Optional(
    Type.String({ description: 'Task id (required for update/delete)' }),
  ),
  title: Type.Optional(Type.String({ description: 'Task title (required for create)' })),
  notes: Type.Optional(Type.String({ description: 'Task notes' })),
  due: Type.Optional(Type.String({ description: 'Due date (YYYY-MM-DD only)' })),
  status: Type.Optional(
    Type.Union([Type.Literal('needsAction'), Type.Literal('completed')], {
      description: 'Task status for update (use completed to mark done)',
    }),
  ),
  skipDuplicateCheck: Type.Optional(
    Type.Boolean({
      description:
        'When true, always create even if a matching open task exists (default: false)',
    }),
  ),
});

type TasksWriteAction = 'create' | 'update' | 'delete';

/** Registers the `tasks_write` tool for worker agents. */
export function registerTasksWriteTool(pi: ExtensionAPI, ctx: IntegrationContext): void {
  pi.registerTool({
    name: 'tasks_write',
    label: 'tasks_write',
    description:
      'Create, update, or delete Google Tasks. Retries should reuse taskId and tasklistId from prior results.',
    promptSnippet: 'Create or modify Google Tasks',
    promptGuidelines: [
      'Use tasks_write to add, update, complete, or delete Google Tasks.',
      'tasklistId is required on every call — take it from prior tasks_read or tasks_write results.',
      'To complete a task, use update with status: completed.',
      'On create, the tool checks open tasks (one page) for a matching title before inserting.',
    ],
    parameters: tasksWriteSchema,
    async execute(_toolCallId, params, signal) {
      try {
        if (signal?.aborted) {
          return cancelledToolResult();
        }

        const accessToken = await resolveGoogleAccessToken(ctx);
        const text = await runTasksWriteAction(accessToken, params);
        return textToolResult(text);
      } catch (error) {
        if (signal?.aborted) {
          return cancelledToolResult();
        }

        return textToolResult(formatGoogleToolError('Tasks', error, ctx.userId));
      }
    },
  });
}

/** Dispatches a tasks write action and returns a plain-text summary. */
async function runTasksWriteAction(
  accessToken: string,
  params: {
    action: TasksWriteAction;
    tasklistId: string;
    taskId?: string;
    title?: string;
    notes?: string;
    due?: string;
    status?: 'needsAction' | 'completed';
    skipDuplicateCheck?: boolean;
  },
): Promise<string> {
  switch (params.action) {
    case 'create':
      return createTaskAction(accessToken, params);
    case 'update':
      return updateTaskAction(accessToken, params);
    case 'delete':
      return deleteTaskAction(accessToken, params);
    default: {
      const _exhaustive: never = params.action;
      return _exhaustive;
    }
  }
}

/** Creates a task, reusing an existing match when found for idempotent retries. */
async function createTaskAction(
  accessToken: string,
  params: {
    tasklistId: string;
    title?: string;
    notes?: string;
    due?: string;
    skipDuplicateCheck?: boolean;
  },
): Promise<string> {
  if (params.title === undefined) {
    return 'create requires title.';
  }

  let due: string | undefined;
  if (params.due !== undefined) {
    try {
      due = parseDateOnly(params.due);
    } catch (error) {
      if (error instanceof Error) {
        return error.message;
      }
      return 'Invalid due date.';
    }
  }

  if (params.skipDuplicateCheck !== true) {
    const existing = await findExistingOpenTask(accessToken, {
      tasklistId: params.tasklistId,
      title: params.title,
      ...(due !== undefined ? { due } : {}),
    });
    if (existing !== undefined) {
      return summarizeSingleTask(existing, 'Existing task found (idempotent create):');
    }
  }

  const created = await createTask(accessToken, {
    tasklistId: params.tasklistId,
    title: params.title,
    ...(params.notes !== undefined ? { notes: params.notes } : {}),
    ...(due !== undefined ? { due } : {}),
  });

  return summarizeSingleTask(created, 'Task created:');
}

/** Updates a task by id. */
async function updateTaskAction(
  accessToken: string,
  params: {
    tasklistId: string;
    taskId?: string;
    title?: string;
    notes?: string;
    due?: string;
    status?: 'needsAction' | 'completed';
  },
): Promise<string> {
  if (params.taskId === undefined) {
    return 'update requires taskId.';
  }

  let due: string | undefined;
  if (params.due !== undefined) {
    try {
      due = parseDateOnly(params.due);
    } catch (error) {
      if (error instanceof Error) {
        return error.message;
      }
      return 'Invalid due date.';
    }
  }

  const updated = await updateTask(accessToken, {
    tasklistId: params.tasklistId,
    taskId: params.taskId,
    ...(params.title !== undefined ? { title: params.title } : {}),
    ...(params.notes !== undefined ? { notes: params.notes } : {}),
    ...(due !== undefined ? { due } : {}),
    ...(params.status !== undefined ? { status: params.status } : {}),
  });

  return summarizeSingleTask(updated, 'Task updated:');
}

/** Deletes a task by id. */
async function deleteTaskAction(
  accessToken: string,
  params: { tasklistId: string; taskId?: string },
): Promise<string> {
  if (params.taskId === undefined) {
    return 'delete requires taskId.';
  }

  await deleteTask(accessToken, params.tasklistId, params.taskId);
  return `Task ${params.taskId} deleted from list ${params.tasklistId}.`;
}
