import {
  ListTasksQuerySchema,
  toTaskSummary,
  type ListTasksResponse,
} from '../contracts/tasks.js';
import { createChildLogger, createRootLogger, type AppLogger } from '../logging/index.js';
import type { TaskQueue } from '../queue/sqliteTaskQueue.js';

export type ListTasksControllerDependencies = {
  taskQueue: TaskQueue;
  logger?: AppLogger;
};

export type ListTasksSuccess = {
  status: 200;
  body: ListTasksResponse;
};

export type ListTasksFailure = {
  status: 400;
  body: {
    code: 'validation_error';
    message: string;
  };
};

export type ListTasksResult = ListTasksSuccess | ListTasksFailure;

type HandleOptions = {
  logger?: AppLogger;
};

/** Validates list-tasks queries, applies HTTP defaults, and delegates to the queue. */
export class ListTasksController {
  private readonly taskQueue: TaskQueue;
  private readonly logger: AppLogger;

  /** Creates a controller with the task queue and optional logger. */
  constructor(dependencies: ListTasksControllerDependencies) {
    this.taskQueue = dependencies.taskQueue;
    this.logger = dependencies.logger ?? createRootLogger();
  }

  /** Validates query params and returns a JSON response body with status code. */
  async handle(
    rawQuery: unknown,
    options: HandleOptions = {},
  ): Promise<ListTasksResult> {
    const log = createChildLogger(options.logger ?? this.logger, {
      component: 'tasks.controller',
    });
    const validation = ListTasksQuerySchema.safeParse(rawQuery);

    if (!validation.success) {
      log.warn(
        { event: 'tasks.list.validation_failed' },
        'tasks list query validation failed',
      );
      return {
        status: 400,
        body: {
          code: 'validation_error',
          message:
            'Query must include user_id and optional status and limit parameters.',
        },
      };
    }

    const query = validation.data;
    const requestLog = createChildLogger(log, {
      component: 'tasks.controller',
      user_id: query.userId,
    });

    const records = await this.taskQueue.listByUser(query.userId, {
      statuses: query.statuses,
      limit: query.limit,
    });

    const body: ListTasksResponse = {
      tasks: records.map((record) => toTaskSummary(record)),
    };

    requestLog.info(
      {
        event: 'tasks.list.completed',
        status_filter: query.statuses,
        task_count: body.tasks.length,
      },
      'tasks list completed',
    );

    return { status: 200, body };
  }
}
