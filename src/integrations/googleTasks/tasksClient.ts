import type { tasks_v1 } from 'googleapis';

import {
  buildDateRangeInTimezone,
  parseDateOnly,
  toTasksApiDueBound,
  type DateOnly,
} from '../google/dateBounds.js';

/** Normalized task list returned to integration tools. */
export type TaskListSummary = {
  id: string;
  title: string;
};

/** Normalized task returned to integration tools. */
export type TaskSummary = {
  listId: string;
  listTitle: string;
  id: string;
  title: string;
  status: string;
  due?: DateOnly;
  notes?: string;
  completed?: string;
};

/** Options for listing tasks within a task list. */
export type ListTasksOptions = {
  tasklistId?: string;
  dueMin?: DateOnly;
  dueMax?: DateOnly;
  showCompleted?: boolean;
  maxResults?: number;
};

/** Fields required to create a task. */
export type CreateTaskInput = {
  tasklistId: string;
  title: string;
  notes?: string;
  due?: DateOnly;
};

/** Fields for updating an existing task. */
export type UpdateTaskInput = {
  tasklistId: string;
  taskId: string;
  title?: string;
  notes?: string;
  due?: DateOnly;
  status?: 'needsAction' | 'completed';
};

/** Injectable Tasks API surface for tests. */
export type TasksApi = Pick<tasks_v1.Tasks, 'tasklists' | 'tasks'>;

const DEFAULT_MAX_RESULTS = 50;
const API_MAX_RESULTS = 100;

/** Creates a googleapis Tasks client authenticated with a bearer access token. */
export async function createTasksApi(accessToken: string): Promise<TasksApi> {
  const { google } = await import('googleapis');
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.tasks({ version: 'v1', auth });
}

/** Lists all task lists for the authenticated user. */
export async function listTaskLists(
  accessToken: string,
  tasksApi?: TasksApi,
): Promise<TaskListSummary[]> {
  const api = tasksApi ?? (await createTasksApi(accessToken));
  const response = await api.tasklists.list({ maxResults: 1000 });
  const items = response.data.items ?? [];

  return items
    .filter((list) => list.id !== undefined && list.id !== null)
    .map((list) => ({
      id: list.id!,
      title: list.title?.trim() || '(untitled list)',
    }));
}

/**
 * Resolves a task list id for read operations when omitted.
 * Uses the first list returned by the API as a convenience default.
 */
export async function resolveTaskListForRead(
  accessToken: string,
  tasklistId: string | undefined,
  tasksApi?: TasksApi,
): Promise<TaskListSummary> {
  if (tasklistId !== undefined) {
    const api = tasksApi ?? (await createTasksApi(accessToken));
    const response = await api.tasklists.get({ tasklist: tasklistId });
    const id = response.data.id;
    if (id === undefined || id === null) {
      throw new Error(`Task list "${tasklistId}" was not found.`);
    }
    return {
      id,
      title: response.data.title?.trim() || '(untitled list)',
    };
  }

  const lists = await listTaskLists(accessToken, tasksApi);
  if (lists.length === 0) {
    throw new Error('No task lists found for this Google account.');
  }

  return lists[0]!;
}

/** Lists tasks in a task list with optional due-date and completion filters. */
export async function listTasks(
  accessToken: string,
  options: ListTasksOptions = {},
  tasksApi?: TasksApi,
): Promise<{ tasks: TaskSummary[]; truncated: boolean; list: TaskListSummary }> {
  const list = await resolveTaskListForRead(accessToken, options.tasklistId, tasksApi);
  const api = tasksApi ?? (await createTasksApi(accessToken));
  const maxResults = Math.min(options.maxResults ?? DEFAULT_MAX_RESULTS, API_MAX_RESULTS);
  const showCompleted = options.showCompleted ?? false;

  const listParams: tasks_v1.Params$Resource$Tasks$List = {
    tasklist: list.id,
    maxResults,
    showCompleted,
    showHidden: false,
    showDeleted: false,
  };

  if (options.dueMin !== undefined) {
    listParams.dueMin = toTasksApiDueBound(options.dueMin, 'start');
  }
  if (options.dueMax !== undefined) {
    listParams.dueMax = toTasksApiDueBound(options.dueMax, 'end');
  }

  const response = await api.tasks.list(listParams);
  const items = response.data.items ?? [];
  const truncated = response.data.nextPageToken !== undefined && response.data.nextPageToken !== null;

  const tasks = items
    .filter((task) => task.id !== undefined && task.id !== null)
    .map((task) => formatTask(task, list));

  return { tasks, truncated, list };
}

/** Builds dueMin/dueMax from a single calendar date or an explicit range. */
export function buildDueFilter(
  input: { date?: string; dueMin?: string; dueMax?: string },
): { dueMin?: DateOnly; dueMax?: DateOnly } | { error: string } {
  if (input.date !== undefined) {
    try {
      const date = parseDateOnly(input.date);
      return { dueMin: date, dueMax: date };
    } catch (error) {
      if (error instanceof Error) {
        return { error: error.message };
      }
      return { error: 'Invalid date.' };
    }
  }

  if (input.dueMin !== undefined || input.dueMax !== undefined) {
    if (input.dueMin === undefined || input.dueMax === undefined) {
      return { error: 'Due range filters require both dueMin and dueMax (YYYY-MM-DD).' };
    }
    try {
      return {
        dueMin: parseDateOnly(input.dueMin),
        dueMax: parseDateOnly(input.dueMax),
      };
    } catch (error) {
      if (error instanceof Error) {
        return { error: error.message };
      }
      return { error: 'Invalid due range.' };
    }
  }

  return {};
}

/** Creates a task and returns the created task summary. */
export async function createTask(
  accessToken: string,
  input: CreateTaskInput,
  tasksApi?: TasksApi,
): Promise<TaskSummary> {
  const api = tasksApi ?? (await createTasksApi(accessToken));
  const list = await resolveTaskListForRead(accessToken, input.tasklistId, tasksApi);

  const requestBody: tasks_v1.Schema$Task = {
    title: input.title,
    status: 'needsAction',
  };

  if (input.notes !== undefined) {
    requestBody.notes = input.notes;
  }
  if (input.due !== undefined) {
    requestBody.due = toTasksApiDueBound(input.due, 'start');
  }

  const response = await api.tasks.insert({
    tasklist: list.id,
    requestBody,
  });

  return formatTask(response.data, list);
}

/** Updates an existing task by id. */
export async function updateTask(
  accessToken: string,
  input: UpdateTaskInput,
  tasksApi?: TasksApi,
): Promise<TaskSummary> {
  const api = tasksApi ?? (await createTasksApi(accessToken));
  const list = await resolveTaskListForRead(accessToken, input.tasklistId, tasksApi);

  const requestBody: tasks_v1.Schema$Task = {};

  if (input.title !== undefined) {
    requestBody.title = input.title;
  }
  if (input.notes !== undefined) {
    requestBody.notes = input.notes;
  }
  if (input.due !== undefined) {
    requestBody.due = toTasksApiDueBound(input.due, 'start');
  }
  if (input.status !== undefined) {
    requestBody.status = input.status;
  }

  const response = await api.tasks.patch({
    tasklist: list.id,
    task: input.taskId,
    requestBody,
  });

  return formatTask(response.data, list);
}

/** Deletes a task by id. */
export async function deleteTask(
  accessToken: string,
  tasklistId: string,
  taskId: string,
  tasksApi?: TasksApi,
): Promise<void> {
  const api = tasksApi ?? (await createTasksApi(accessToken));
  await api.tasks.delete({ tasklist: tasklistId, task: taskId });
}

/**
 * Finds an open task with the same title (and due date when provided) for idempotent creates.
 * Scans at most one page of open tasks.
 */
export async function findExistingOpenTask(
  accessToken: string,
  input: { tasklistId: string; title: string; due?: DateOnly },
  tasksApi?: TasksApi,
): Promise<TaskSummary | undefined> {
  const { tasks } = await listTasks(
    accessToken,
    {
      tasklistId: input.tasklistId,
      showCompleted: false,
      maxResults: API_MAX_RESULTS,
    },
    tasksApi,
  );

  return tasks.find((task) => {
    if (task.title !== input.title || task.status !== 'needsAction') {
      return false;
    }
    if (input.due !== undefined) {
      return task.due === input.due;
    }
    return true;
  });
}

/** Formats one Google task into a normalized summary. */
export function formatTask(
  task: tasks_v1.Schema$Task,
  list: TaskListSummary,
): TaskSummary {
  const id = task.id ?? '';
  const title = task.title?.trim() || '(no title)';
  const status = task.status ?? 'needsAction';

  const summary: TaskSummary = {
    listId: list.id,
    listTitle: list.title,
    id,
    title,
    status,
  };

  const due = formatTaskDueDate(task.due);
  if (due !== undefined) {
    summary.due = due;
  }
  if (task.notes !== undefined && task.notes !== null && task.notes !== '') {
    summary.notes = task.notes;
  }
  if (task.completed !== undefined && task.completed !== null) {
    summary.completed = task.completed;
  }

  return summary;
}

/** Extracts YYYY-MM-DD from a Tasks API due timestamp. */
export function formatTaskDueDate(due: string | null | undefined): DateOnly | undefined {
  if (due === undefined || due === null || due === '') {
    return undefined;
  }

  const datePart = due.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return datePart;
  }

  return undefined;
}

/** Re-export day bounds helper used when building due filters from calendar dates. */
export { buildDateRangeInTimezone };
