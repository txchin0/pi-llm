import { describe, expect, it } from 'vitest';

import type { TaskListRecord } from '../../src/queue/taskTypes.js';
import { createTaskListService } from '../../src/tasks/taskListService.js';

describe('createTaskListService', () => {
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
    };

    const service = createTaskListService({
      taskQueue: {
        async enqueue() {
          throw new Error('not used');
        },
        async getById() {
          return null;
        },
        async listByUser(_userId, options) {
          expect(options.statuses).toEqual(['pending', 'running']);
          expect(options.limit).toBe(10);
          return [record];
        },
      },
    });

    const response = await service.listTasks({
      userId: 'web-user',
      statuses: ['pending', 'running'],
      limit: 10,
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
      },
    ]);
  });
});
