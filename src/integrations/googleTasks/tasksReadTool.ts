import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import type { IntegrationContext } from '../types.js';
import {
  cancelledToolResult,
  formatGoogleToolError,
  resolveGoogleAccessToken,
  textToolResult,
} from '../google/toolRuntime.js';
import { summarizeTaskLists, summarizeTasks } from './taskSummaries.js';
import { buildDueFilter, listTaskLists, listTasks } from './tasksClient.js';

const tasksReadSchema = Type.Object({
  listTaskLists: Type.Optional(
    Type.Boolean({
      description: 'When true, list all task lists and ignore other filters',
    }),
  ),
  tasklistId: Type.Optional(
    Type.String({ description: 'Task list id (optional; defaults to first list for reads)' }),
  ),
  date: Type.Optional(
    Type.String({ description: 'Filter tasks due on this calendar date (YYYY-MM-DD)' }),
  ),
  dueMin: Type.Optional(
    Type.String({ description: 'Filter tasks due on or after this date (YYYY-MM-DD)' }),
  ),
  dueMax: Type.Optional(
    Type.String({ description: 'Filter tasks due on or before this date (YYYY-MM-DD)' }),
  ),
  showCompleted: Type.Optional(
    Type.Boolean({ description: 'Include completed tasks (default: false)' }),
  ),
  maxResults: Type.Optional(
    Type.Number({
      description: 'Maximum tasks to return (default: 50, max: 100)',
      minimum: 1,
      maximum: 100,
    }),
  ),
});

/** Registers the `tasks_read` tool for surface agents. */
export function registerTasksReadTool(pi: ExtensionAPI, ctx: IntegrationContext): void {
  pi.registerTool({
    name: 'tasks_read',
    label: 'tasks_read',
    description:
      'Read Google Tasks: list task lists or query tasks with optional due-date and completion filters.',
    promptSnippet: 'Read the user Google Tasks todo lists',
    promptGuidelines: [
      'Use tasks_read when the user asks about todos, due tasks, or task lists.',
      'When the user names a specific day, pass date (YYYY-MM-DD). For ranges, pass dueMin and dueMax.',
      'Always note list id and task id from results; the worker needs list id for writes.',
    ],
    parameters: tasksReadSchema,
    async execute(_toolCallId, params, signal) {
      try {
        if (signal?.aborted) {
          return cancelledToolResult();
        }

        const accessToken = await resolveGoogleAccessToken(ctx);

        if (params.listTaskLists === true) {
          const lists = await listTaskLists(accessToken);
          return textToolResult(summarizeTaskLists(lists));
        }

        const dueFilter = buildDueFilter({
          ...(params.date !== undefined ? { date: params.date } : {}),
          ...(params.dueMin !== undefined ? { dueMin: params.dueMin } : {}),
          ...(params.dueMax !== undefined ? { dueMax: params.dueMax } : {}),
        });

        if ('error' in dueFilter) {
          return textToolResult(dueFilter.error);
        }

        const listOptions = {
          ...(params.tasklistId !== undefined ? { tasklistId: params.tasklistId } : {}),
          ...(dueFilter.dueMin !== undefined ? { dueMin: dueFilter.dueMin } : {}),
          ...(dueFilter.dueMax !== undefined ? { dueMax: dueFilter.dueMax } : {}),
          showCompleted: params.showCompleted ?? false,
          ...(params.maxResults !== undefined ? { maxResults: params.maxResults } : {}),
        };

        const { tasks, truncated, list } = await listTasks(accessToken, listOptions);
        return textToolResult(summarizeTasks(tasks, list, truncated));
      } catch (error) {
        if (signal?.aborted) {
          return cancelledToolResult();
        }

        return textToolResult(formatGoogleToolError('Tasks', error, ctx.userId));
      }
    },
  });
}
