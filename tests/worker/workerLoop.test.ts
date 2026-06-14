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
  let claimNextPending: ReturnType<typeof vi.fn<WorkerTaskQueue['claimNextPending']>>;
  let markCompleted: ReturnType<typeof vi.fn<WorkerTaskQueue['markCompleted']>>;
  let markFailed: ReturnType<typeof vi.fn<WorkerTaskQueue['markFailed']>>;
  let requeue: ReturnType<typeof vi.fn<WorkerTaskQueue['requeue']>>;
  let runTask: ReturnType<typeof vi.fn<WorkerTaskService['runTask']>>;
  let taskQueue: WorkerTaskQueue;
  let workerTaskService: WorkerTaskService;
  let loop: WorkerLoop;

  beforeEach(() => {
    vi.useFakeTimers();

    claimNextPending = vi.fn<WorkerTaskQueue['claimNextPending']>().mockResolvedValue(null);
    markCompleted = vi.fn<WorkerTaskQueue['markCompleted']>().mockResolvedValue(undefined);
    markFailed = vi.fn<WorkerTaskQueue['markFailed']>().mockResolvedValue(undefined);
    requeue = vi.fn<WorkerTaskQueue['requeue']>().mockResolvedValue(undefined);
    runTask = vi.fn<WorkerTaskService['runTask']>().mockResolvedValue('done');

    taskQueue = {
      enqueue: vi.fn(),
      getById: vi.fn(),
      listByUser: vi.fn(),
      claimNextPending,
      markCompleted,
      markFailed,
      requeue,
      requeueStuckRunning: vi.fn().mockResolvedValue(0),
    };

    workerTaskService = {
      runTask,
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
    claimNextPending.mockResolvedValueOnce(task);

    loop.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(runTask).toHaveBeenCalledWith(task, expect.any(AbortSignal));
    expect(markCompleted).toHaveBeenCalledWith(task.id, 'done');
  });

  it('requeues a failed task while retries remain', async () => {
    const task = createTask({ retryCount: 0 });
    claimNextPending.mockResolvedValueOnce(task);
    runTask.mockRejectedValueOnce(new Error('transient'));

    loop.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(requeue).toHaveBeenCalledWith(task.id, 'transient');
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('marks a task failed after retries are exhausted', async () => {
    const task = createTask({ retryCount: 2 });
    claimNextPending.mockResolvedValueOnce(task);
    runTask.mockRejectedValueOnce(new Error('permanent'));

    loop.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(requeue).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith(task.id, 'permanent');
  });

  it('does not claim another task while one is in flight', async () => {
    const first = createTask({ id: 'task_first00000001' });
    const second = createTask({ id: 'task_second00000002' });

    claimNextPending
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    let releaseFirst: (() => void) | undefined;
    runTask.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseFirst = () => resolve('done');
        }),
    );

    loop.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(claimNextPending).toHaveBeenCalledTimes(1);
    expect(runTask).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(claimNextPending).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await vi.advanceTimersByTimeAsync(1000);

    expect(claimNextPending).toHaveBeenCalledTimes(2);
    expect(runTask).toHaveBeenCalledTimes(2);
  });

  it('marks a task failed when the service times out', async () => {
    const task = createTask({ retryCount: 2 });
    claimNextPending.mockResolvedValueOnce(task);
    runTask.mockImplementationOnce((_task, signal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const reason: unknown = signal.reason;
          reject(
            reason instanceof Error
              ? reason
              : new Error('Worker task timed out'),
          );
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

    expect(markFailed).toHaveBeenCalledWith(task.id, 'Worker task timed out');
  });
});
