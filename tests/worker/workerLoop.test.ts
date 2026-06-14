import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkerTaskQueue } from '../../src/queue/taskQueue.js';
import type { TaskRecord } from '../../src/queue/taskTypes.js';
import { WorkerLoop } from '../../src/worker/workerLoop.js';
import type { WorkerTaskService } from '../../src/worker/workerTaskService.js';

function createTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task_test00000001',
    userId: 'web-user',
    description: 'test task',
    context: { turns: [] },
    sessionId: null,
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    retryCount: 0,
    result: null,
    errorMessage: null,
    ...overrides,
  };
}

describe('WorkerLoop', () => {
  let taskQueue: WorkerTaskQueue;
  let workerTaskService: WorkerTaskService;
  let loop: WorkerLoop;

  beforeEach(() => {
    vi.useFakeTimers();

    taskQueue = {
      enqueue: vi.fn(),
      getById: vi.fn(),
      listByUser: vi.fn(),
      claimNextPending: vi.fn().mockResolvedValue(null),
      markCompleted: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      requeue: vi.fn().mockResolvedValue(undefined),
      requeueStuckRunning: vi.fn().mockResolvedValue(0),
    };

    workerTaskService = {
      runTask: vi.fn().mockResolvedValue('done'),
    };

    loop = new WorkerLoop({
      taskQueue,
      workerTaskService,
      pollIntervalMs: 1000,
      maxRetries: 2,
      taskTimeoutMs: 30_000,
    });
  });

  afterEach(async () => {
    await loop.stop();
    vi.useRealTimers();
  });

  it('marks a claimed task completed when the service succeeds', async () => {
    const task = createTask();
    vi.mocked(taskQueue.claimNextPending).mockResolvedValueOnce(task);

    loop.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(workerTaskService.runTask).toHaveBeenCalledWith(
      task,
      expect.any(AbortSignal),
    );
    expect(taskQueue.markCompleted).toHaveBeenCalledWith(task.id, 'done');
  });

  it('requeues a failed task while retries remain', async () => {
    const task = createTask({ retryCount: 0 });
    vi.mocked(taskQueue.claimNextPending).mockResolvedValueOnce(task);
    vi.mocked(workerTaskService.runTask).mockRejectedValueOnce(
      new Error('transient'),
    );

    loop.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(taskQueue.requeue).toHaveBeenCalledWith(task.id, 'transient');
    expect(taskQueue.markFailed).not.toHaveBeenCalled();
  });

  it('marks a task failed after retries are exhausted', async () => {
    const task = createTask({ retryCount: 2 });
    vi.mocked(taskQueue.claimNextPending).mockResolvedValueOnce(task);
    vi.mocked(workerTaskService.runTask).mockRejectedValueOnce(
      new Error('permanent'),
    );

    loop.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(taskQueue.requeue).not.toHaveBeenCalled();
    expect(taskQueue.markFailed).toHaveBeenCalledWith(task.id, 'permanent');
  });

  it('does not claim another task while one is in flight', async () => {
    const first = createTask({ id: 'task_first00000001' });
    const second = createTask({ id: 'task_second00000002' });

    vi.mocked(taskQueue.claimNextPending)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    let releaseFirst: (() => void) | undefined;
    vi.mocked(workerTaskService.runTask).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseFirst = () => resolve('done');
        }),
    );

    loop.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(taskQueue.claimNextPending).toHaveBeenCalledTimes(1);
    expect(workerTaskService.runTask).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(taskQueue.claimNextPending).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await vi.advanceTimersByTimeAsync(1000);

    expect(taskQueue.claimNextPending).toHaveBeenCalledTimes(2);
    expect(workerTaskService.runTask).toHaveBeenCalledTimes(2);
  });

  it('marks a task failed when the service times out', async () => {
    const task = createTask({ retryCount: 2 });
    vi.mocked(taskQueue.claimNextPending).mockResolvedValueOnce(task);
    vi.mocked(workerTaskService.runTask).mockImplementationOnce(
      (_task, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason ?? new Error('Worker task timed out'));
          });
        }),
    );

    loop = new WorkerLoop({
      taskQueue,
      workerTaskService,
      pollIntervalMs: 1000,
      maxRetries: 2,
      taskTimeoutMs: 100,
    });

    loop.start();
    await vi.advanceTimersByTimeAsync(1100);

    expect(taskQueue.markFailed).toHaveBeenCalledWith(
      task.id,
      'Worker task timed out',
    );
  });
});
