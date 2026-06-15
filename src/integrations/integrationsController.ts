import {
  ListIntegrationsQuerySchema,
  type ListIntegrationsResponse,
  UpdateIntegrationsRequestSchema,
} from '../contracts/integrations.js';
import { createChildLogger, createRootLogger, type AppLogger } from '../logging/index.js';
import type { IntegrationService } from './integrationService.js';

export type IntegrationsControllerDependencies = {
  service: IntegrationService;
  logger?: AppLogger;
};

export type IntegrationsListSuccess = {
  status: 200;
  body: ListIntegrationsResponse;
};

export type IntegrationsUpdateSuccess = {
  status: 200;
  body: ListIntegrationsResponse;
};

export type IntegrationsFailure = {
  status: 400;
  body: {
    code: 'validation_error';
    message: string;
  };
};

export type IntegrationsListResult = IntegrationsListSuccess | IntegrationsFailure;
export type IntegrationsUpdateResult = IntegrationsUpdateSuccess | IntegrationsFailure;

type HandleOptions = {
  logger?: AppLogger;
};

/** Validates integration list and update requests and delegates to the integration service. */
export class IntegrationsController {
  private readonly service: IntegrationService;
  private readonly logger: AppLogger;

  /** Creates a controller with the integration service and optional logger. */
  constructor(dependencies: IntegrationsControllerDependencies) {
    this.service = dependencies.service;
    this.logger = dependencies.logger ?? createRootLogger();
  }

  /** Validates query params and returns integration summaries for the user. */
  async handleList(
    rawQuery: unknown,
    options: HandleOptions = {},
  ): Promise<IntegrationsListResult> {
    const log = createChildLogger(options.logger ?? this.logger, {
      component: 'integrations.controller',
    });
    const validation = ListIntegrationsQuerySchema.safeParse(rawQuery);

    if (!validation.success) {
      log.warn(
        { event: 'integrations.list.validation_failed' },
        'integrations list query validation failed',
      );
      return {
        status: 400,
        body: {
          code: 'validation_error',
          message: 'Query must include user_id.',
        },
      };
    }

    const query = validation.data;
    const requestLog = createChildLogger(log, {
      component: 'integrations.controller',
      user_id: query.userId,
    });

    const body = await this.service.listForUser(query.userId);

    requestLog.info(
      {
        event: 'integrations.list.succeeded',
        integration_count: body.integrations.length,
      },
      'integrations list succeeded',
    );

    return { status: 200, body };
  }

  /** Validates the update body and applies integration enablement patches for the user. */
  async handleUpdate(
    rawBody: unknown,
    options: HandleOptions = {},
  ): Promise<IntegrationsUpdateResult> {
    const log = createChildLogger(options.logger ?? this.logger, {
      component: 'integrations.controller',
    });
    const validation = UpdateIntegrationsRequestSchema.safeParse(rawBody);

    if (!validation.success) {
      log.warn(
        { event: 'integrations.update.validation_failed' },
        'integrations update body validation failed',
      );
      return {
        status: 400,
        body: {
          code: 'validation_error',
          message:
            'Body must include user_id and integrations with enabled booleans only.',
        },
      };
    }

    const request = validation.data;
    const requestLog = createChildLogger(log, {
      component: 'integrations.controller',
      user_id: request.userId,
    });

    const result = await this.service.updateForUser(request);

    if (!result.ok) {
      requestLog.warn(
        {
          event: 'integrations.update.unknown_integration',
          integration_id: result.integrationId,
        },
        'integrations update referenced unknown integration',
      );
      return {
        status: 400,
        body: {
          code: 'validation_error',
          message: `Unknown integration id: ${result.integrationId}`,
        },
      };
    }

    requestLog.info(
      {
        event: 'integrations.update.succeeded',
        patched_integration_count: Object.keys(request.patches).length,
        integration_count: result.body.integrations.length,
      },
      'integrations update succeeded',
    );

    return { status: 200, body: result.body };
  }
}
