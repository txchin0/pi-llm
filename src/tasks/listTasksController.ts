import {
  ListTasksQuerySchema,
  type ListTasksResponse,
} from '../contracts/tasks.js';
import { createChildLogger, createRootLogger, type AppLogger } from '../logging/index.js';
import type { TaskListService } from './taskListService.js';

export type ListTasksControllerDependencies = {
  service: TaskListService;
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

/** Validates list-tasks queries and delegates to the task list service. */
export class ListTasksController {
  private readonly service: TaskListService;
  private readonly logger: AppLogger;

  /** Creates a controller with the task list service and optional logger. */
  constructor(dependencies: ListTasksControllerDependencies) {
    this.service = dependencies.service;
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

    const body = await this.service.listTasks(query);

    requestLog.info(
      {
        event: 'tasks.list.succeeded',
        status_filter: query.statuses,
        task_count: body.tasks.length,
      },
      'tasks list succeeded',
    );

    return { status: 200, body };
  }
}
