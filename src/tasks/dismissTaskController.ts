import { z } from 'zod';

import type { DismissTaskError } from '../contracts/tasks.js';
import { createChildLogger, createRootLogger, type AppLogger } from '../logging/index.js';
import type { DismissTaskOutcome } from '../queue/taskQueue.js';
import type { TaskService } from './taskService.js';

export type DismissTaskControllerDependencies = {
  service: TaskService;
  logger?: AppLogger;
};

export type DismissTaskSuccess = {
  status: 204;
  body: undefined;
};

export type DismissTaskFailure = {
  status: 404 | 409;
  body: DismissTaskError;
};

export type DismissTaskResult = DismissTaskSuccess | DismissTaskFailure;

const TaskIdSchema = z.string().trim().min(1);

type HandleOptions = {
  /** Authenticated user id from the bearer token — the only identity source. */
  userId: string;
  logger?: AppLogger;
};

/**
 * Dismisses a finished task so it no longer appears in task lists.
 * Dismissing an already-dismissed task succeeds (idempotent), so client
 * retries and double-clicks cannot error spuriously.
 */
export class DismissTaskController {
  private readonly service: TaskService;
  private readonly logger: AppLogger;

  /** Creates a controller with the task service and optional logger. */
  constructor(dependencies: DismissTaskControllerDependencies) {
    this.service = dependencies.service;
    this.logger = dependencies.logger ?? createRootLogger();
  }

  /** Validates the task id and returns a status code with an optional error body. */
  async handle(
    rawTaskId: unknown,
    options: HandleOptions,
  ): Promise<DismissTaskResult> {
    const log = createChildLogger(options.logger ?? this.logger, {
      component: 'tasks.dismiss_controller',
      user_id: options.userId,
    });

    const validation = TaskIdSchema.safeParse(rawTaskId);
    if (!validation.success) {
      return {
        status: 404,
        body: { code: 'not_found', message: 'Task not found.' },
      };
    }

    const outcome = await this.service.dismissTask(
      options.userId,
      validation.data,
    );

    return mapDismissOutcome(outcome, validation.data, log);
  }
}

/** Maps a dismiss port outcome to an HTTP result and logs the decision. */
function mapDismissOutcome(
  outcome: DismissTaskOutcome,
  taskId: string,
  log: AppLogger,
): DismissTaskResult {
  switch (outcome) {
    case 'dismissed':
      log.info(
        { event: 'tasks.dismiss.succeeded', task_id: taskId },
        'task dismissed',
      );
      return { status: 204, body: undefined };
    case 'not_found':
      log.info(
        { event: 'tasks.dismiss.not_found', task_id: taskId },
        'task dismiss target not found',
      );
      return {
        status: 404,
        body: { code: 'not_found', message: 'Task not found.' },
      };
    case 'not_terminal':
      log.info(
        { event: 'tasks.dismiss.not_terminal', task_id: taskId },
        'task dismiss rejected for active task',
      );
      return {
        status: 409,
        body: {
          code: 'task_not_terminal',
          message: 'Only completed or failed tasks can be dismissed.',
        },
      };
    default: {
      const _exhaustive: never = outcome;
      throw new Error(`Unhandled dismiss outcome: ${_exhaustive}`);
    }
  }
}
