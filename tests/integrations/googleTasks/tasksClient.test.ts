import { describe, expect, it, vi } from 'vitest';

import {
  buildDueFilter,
  findExistingOpenTask,
  formatTask,
  formatTaskDueDate,
  listTaskLists,
  listTasks,
  type TasksApi,
} from '../../../src/integrations/googleTasks/tasksClient.js';
import { summarizeTaskLists, summarizeTasks } from '../../../src/integrations/googleTasks/taskSummaries.js';

function mockTasksApi(handlers: {
  listTaskLists?: () => Promise<{ data: { items?: Array<{ id?: string; title?: string }> } }>;
  getTaskList?: (id: string) => Promise<{ data: { id?: string; title?: string } }>;
  listTasks?: (tasklist: string) => Promise<{
    data: {
      items?: Array<{
        id?: string;
        title?: string;
        status?: string;
        due?: string;
        notes?: string;
      }>;
      nextPageToken?: string;
    };
  }>;
}): TasksApi {
  return {
    tasklists: {
      list: vi.fn(handlers.listTaskLists ?? (() => Promise.resolve({ data: { items: [] } }))),
      get: vi.fn((params: { tasklist: string }) =>
        handlers.getTaskList
          ? handlers.getTaskList(params.tasklist)
          : Promise.resolve({ data: { id: params.tasklist, title: 'List' } }),
      ),
    },
    tasks: {
      list: vi.fn((params: { tasklist: string }) =>
        handlers.listTasks
          ? handlers.listTasks(params.tasklist)
          : Promise.resolve({ data: { items: [] } }),
      ),
    },
  } as unknown as TasksApi;
}

describe('formatTaskDueDate', () => {
  it('extracts YYYY-MM-DD from RFC3339 due timestamps', () => {
    expect(formatTaskDueDate('2026-06-25T00:00:00.000Z')).toBe('2026-06-25');
  });
});

describe('formatTask', () => {
  it('normalizes task fields with list context', () => {
    const summary = formatTask(
      { id: 't1', title: 'Buy milk', status: 'needsAction', due: '2026-06-25T00:00:00.000Z' },
      { id: 'l1', title: 'My Tasks' },
    );

    expect(summary).toEqual({
      listId: 'l1',
      listTitle: 'My Tasks',
      id: 't1',
      title: 'Buy milk',
      status: 'needsAction',
      due: '2026-06-25',
    });
  });
});

describe('buildDueFilter', () => {
  it('maps a single date to dueMin and dueMax', () => {
    expect(buildDueFilter({ date: '2026-06-25' })).toEqual({
      dueMin: '2026-06-25',
      dueMax: '2026-06-25',
    });
  });

  it('requires both ends of a due range', () => {
    expect(buildDueFilter({ dueMin: '2026-06-20' })).toEqual({
      error: 'Due range filters require both dueMin and dueMax (YYYY-MM-DD).',
    });
  });
});

describe('listTaskLists', () => {
  it('returns normalized task list summaries', async () => {
    const api = mockTasksApi({
      listTaskLists: () =>
        Promise.resolve({
          data: {
            items: [
              { id: 'list-1', title: 'My Tasks' },
              { id: 'list-2', title: 'Work' },
            ],
          },
        }),
    });

    const lists = await listTaskLists('token', api);
    expect(lists).toEqual([
      { id: 'list-1', title: 'My Tasks' },
      { id: 'list-2', title: 'Work' },
    ]);
  });
});

describe('listTasks', () => {
  it('uses the first list when tasklistId is omitted', async () => {
    const api = mockTasksApi({
      listTaskLists: () =>
        Promise.resolve({ data: { items: [{ id: 'list-1', title: 'My Tasks' }] } }),
      listTasks: () =>
        Promise.resolve({
          data: {
            items: [{ id: 't1', title: 'Todo', status: 'needsAction' }],
          },
        }),
    });

    const result = await listTasks('token', {}, api);
    expect(result.list.id).toBe('list-1');
    expect(result.tasks[0]?.title).toBe('Todo');
    expect(result.truncated).toBe(false);
  });

  it('flags truncation when nextPageToken is present', async () => {
    const api = mockTasksApi({
      listTaskLists: () =>
        Promise.resolve({ data: { items: [{ id: 'list-1', title: 'My Tasks' }] } }),
      listTasks: () =>
        Promise.resolve({
          data: {
            items: [{ id: 't1', title: 'Todo', status: 'needsAction' }],
            nextPageToken: 'more',
          },
        }),
    });

    const result = await listTasks('token', { tasklistId: 'list-1' }, api);
    expect(result.truncated).toBe(true);
  });
});

describe('findExistingOpenTask', () => {
  it('matches open tasks by title and due date', async () => {
    const api = mockTasksApi({
      getTaskList: () => Promise.resolve({ data: { id: 'list-1', title: 'My Tasks' } }),
      listTasks: () =>
        Promise.resolve({
          data: {
            items: [
              { id: 't1', title: 'Buy milk', status: 'needsAction', due: '2026-06-25T00:00:00.000Z' },
              { id: 't2', title: 'Buy milk', status: 'completed', due: '2026-06-25T00:00:00.000Z' },
            ],
          },
        }),
    });

    const existing = await findExistingOpenTask(
      'token',
      { tasklistId: 'list-1', title: 'Buy milk', due: '2026-06-25' },
      api,
    );

    expect(existing?.id).toBe('t1');
  });
});

describe('summarizeTasks', () => {
  it('includes list and task ids for follow-up writes', () => {
    const text = summarizeTasks(
      [
        {
          listId: 'list-1',
          listTitle: 'My Tasks',
          id: 't1',
          title: 'Buy milk',
          status: 'needsAction',
          due: '2026-06-25',
        },
      ],
      { id: 'list-1', title: 'My Tasks' },
      true,
    );

    expect(text).toContain('[list: My Tasks (list-1)]');
    expect(text).toContain('task id: t1');
    expect(text).toContain('list id: list-1');
    expect(text).toContain('possibly more');
  });
});

describe('summarizeTaskLists', () => {
  it('renders list ids for selection', () => {
    const text = summarizeTaskLists([{ id: 'list-1', title: 'My Tasks' }]);
    expect(text).toContain('list id: list-1');
  });
});
