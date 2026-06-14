import type { AppLogger } from '../logging/types.js';
import type { WorkerTaskQueue } from '../queue/taskQueue.js';
import type { TaskRecord } from '../queue/taskTypes.js';
import type { WorkerTaskService } from './workerTaskService.js';

const DEFAULT_STOP_WAIT_MS = 5_000;

export type WorkerLoopDependencies = {
  taskQueue: WorkerTaskQueue;
  workerTaskService: WorkerTaskService;
  pollIntervalMs: number;
  maxRetries: number;
  taskTimeoutMs: number;
  stopWaitMs?: number;
  log?: AppLogger;
};

/** Polls the task queue and runs at most one worker task at a time. */
export class WorkerLoop {
  private readonly taskQueue: WorkerTaskQueue;
  private readonly workerTaskService: WorkerTaskService;
  private readonly pollIntervalMs: number;
  private readonly maxRetries: number;
  private readonly taskTimeoutMs: number;
  private readonly stopWaitMs: number;
  private readonly log: AppLogger | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private running = false;
  private inFlightPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;

  /** Creates a worker loop with queue and service dependencies. */
  constructor(dependencies: WorkerLoopDependencies) {
    this.taskQueue = dependencies.taskQueue;
    this.workerTaskService = dependencies.workerTaskService;
    this.pollIntervalMs = dependencies.pollIntervalMs;
    this.maxRetries = dependencies.maxRetries;
    this.taskTimeoutMs = dependencies.taskTimeoutMs;
    this.stopWaitMs = dependencies.stopWaitMs ?? DEFAULT_STOP_WAIT_MS;
    this.log = dependencies.log;
  }

  /** Starts polling for pending tasks. */
  start(): void {
    this.stopped = false;
    this.scheduleTick();
  }

  /** Stops polling and waits briefly for any in-flight task, aborting if needed. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.inFlightPromise === null) {
      return;
    }

    const inFlight = this.inFlightPromise;
    const timedOut = await Promise.race([
      inFlight.then(() => false),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(true), this.stopWaitMs);
      }),
    ]);

    if (timedOut) {
      this.abortController?.abort(new Error('Worker loop stopped'));
      await inFlight.catch(() => undefined);
    }
  }

  /** Schedules the next poll tick when the loop is active. */
  private scheduleTick(): void {
    if (this.stopped) {
      return;
    }

    this.timer = setTimeout(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  /** Claims and processes one task when no other worker task is running. */
  private async tick(): Promise<void> {
    if (this.stopped || this.running) {
      this.scheduleTick();
      return;
    }

    try {
      const task = await this.taskQueue.claimNextPending();
      if (task === null) {
        return;
      }

      this.running = true;
      this.inFlightPromise = this.processTask(task);
      await this.inFlightPromise;
    } finally {
      this.running = false;
      this.inFlightPromise = null;
      this.abortController = null;
      this.scheduleTick();
    }
  }

  /** Executes one claimed task and updates queue state on success or failure. */
  private async processTask(task: TaskRecord): Promise<void> {
    this.log?.info(
      {
        event: 'worker.task.started',
        task_id: task.id,
        user_id: task.userId,
        session_id: task.sessionId ?? undefined,
        retry_count: task.retryCount,
      },
      'worker task started',
    );

    const abortController = new AbortController();
    this.abortController = abortController;
    const timeoutId = setTimeout(() => {
      abortController.abort(new Error('Worker task timed out'));
    }, this.taskTimeoutMs);

    try {
      const result = await this.workerTaskService.runTask(
        task,
        abortController.signal,
      );
      await this.taskQueue.markCompleted(task.id, result);

      this.log?.info(
        {
          event: 'worker.task.completed',
          task_id: task.id,
          user_id: task.userId,
        },
        'worker task completed',
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Worker task failed';

      if (task.retryCount < this.maxRetries) {
        await this.taskQueue.requeue(task.id, message);

        this.log?.warn(
          {
            event: 'worker.task.retry',
            task_id: task.id,
            user_id: task.userId,
            retry_count: task.retryCount + 1,
            err: error,
          },
          'worker task failed and will retry',
        );
        return;
      }

      await this.taskQueue.markFailed(task.id, message);

      this.log?.error(
        {
          event: 'worker.task.failed',
          task_id: task.id,
          user_id: task.userId,
          err: error,
        },
        'worker task failed permanently',
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
