import type { ExtensionContext, SessionEntry } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

import type { SessionHistoryReader } from '../../src/queue/extractRecentTurns.js';
import type { TaskQueue } from '../../src/queue/sqliteTaskQueue.js';
import { executeScheduleTask } from '../../src/surface/extensions/scheduleTaskTool.js';

function createSessionManager(entries: SessionEntry[] = []): SessionHistoryReader {
  return {
    getBranch: () => entries,
  };
}

function createContext(sessionManager: SessionHistoryReader): ExtensionContext {
  return {
    sessionManager,
  } as ExtensionContext;
}

describe('executeScheduleTask', () => {
  it('rejects an empty description', async () => {
    const taskQueue = {
      enqueue: vi.fn(),
    } as unknown as TaskQueue;

    const result = await executeScheduleTask(
      {
        taskQueue,
        userId: 'web-user',
        sessionId: 'sess_test00000001',
        contextTurnLimit: 3,
      },
      { description: '   ' },
      createContext(createSessionManager()),
    );

    expect(result.content[0]?.text).toContain('non-empty');
    expect(taskQueue.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues a task with server-built context', async () => {
    const sessionManager = createSessionManager([
      {
        type: 'message',
        id: '1',
        parentId: null,
        timestamp: new Date().toISOString(),
        message: {
          role: 'user',
          content: 'Set a reminder for tomorrow',
          timestamp: Date.now(),
        },
      } as SessionEntry,
    ]);

    const enqueue = vi.fn(async () => ({
      id: 'task_abc123def45678',
      userId: 'web-user',
      sessionId: 'sess_test00000001',
      description: 'Set a reminder for tomorrow',
      context: { turns: [{ role: 'user' as const, content: 'Set a reminder for tomorrow' }] },
      status: 'pending' as const,
      createdAt: '2026-06-10T00:00:00.000Z',
      updatedAt: '2026-06-10T00:00:00.000Z',
      retryCount: 0,
      result: null,
      errorMessage: null,
    }));

    const result = await executeScheduleTask(
      {
        taskQueue: { enqueue } as unknown as TaskQueue,
        userId: 'web-user',
        sessionId: 'sess_test00000001',
        contextTurnLimit: 3,
      },
      { description: 'Set a reminder for tomorrow' },
      createContext(sessionManager),
    );

    expect(enqueue).toHaveBeenCalledWith({
      userId: 'web-user',
      sessionId: 'sess_test00000001',
      description: 'Set a reminder for tomorrow',
      context: {
        turns: [{ role: 'user', content: 'Set a reminder for tomorrow' }],
      },
    });
    expect(result.content[0]?.text).toBe(
      'Task queued (id: task_abc123def45678): Set a reminder for tomorrow',
    );
    expect(result.details).toEqual({ task_id: 'task_abc123def45678' });
  });
});
