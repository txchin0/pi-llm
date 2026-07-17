import { describe, expect, it } from 'vitest';

import type { TaskListRecord } from '../../src/queue/taskTypes.js';
import { createTaskService } from '../../src/tasks/taskService.js';
import { createMockUserTaskQueue } from '../helpers/mockTaskQueue.js';

describe('createTaskService', () => {
  it('lists task summaries from the queue', async () => {
    const record: TaskListRecord = {
      id: 'task_abc123',
      description: 'Remember milk',
      status: 'pending',
      createdAt: '2026-06-09T12:00:00.000Z',
      updatedAt: '2026-06-09T12:00:00.000Z',
      retryCount: 0,
      result: null,
      errorMessage: null,
      completedAt: null,
    };

    const service = createTaskService({
      taskQueue: createMockUserTaskQueue({
        listByUser(_userId, options) {
          expect(options.statuses).toEqual(['pending', 'running']);
          expect(options.limit).toBe(10);
          return Promise.resolve([record]);
        },
      }),
    });

    const response = await service.listTasks({
      userId: 'web-user',
      statuses: ['pending', 'running'],
      limit: 10,
      completedAfter: undefined,
    });

    expect(response.tasks).toEqual([
      {
        id: 'task_abc123',
        description: 'Remember milk',
        status: 'pending',
        created_at: '2026-06-09T12:00:00.000Z',
        updated_at: '2026-06-09T12:00:00.000Z',
        retry_count: 0,
        result: null,
        error_message: null,
        completed_at: null,
      },
    ]);
  });

  it('delegates dismiss to the user task queue', async () => {
    const service = createTaskService({
      taskQueue: createMockUserTaskQueue({
        dismiss(userId, taskId) {
          expect(userId).toBe('web-user');
          expect(taskId).toBe('task_abc123');
          return Promise.resolve('dismissed');
        },
      }),
    });

    expect(await service.dismissTask('web-user', 'task_abc123')).toBe(
      'dismissed',
    );
  });
});
