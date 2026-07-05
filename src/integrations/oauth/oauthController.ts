import type { ConnectTokenResponse } from '../../contracts/auth.js';
import {
  buildOAuthConnectedRedirectUrl,
  OAuthCallbackQuerySchema,
  OAuthProviderIdParamSchema,
  OAuthStartQuerySchema,
  toOAuthStatusResponse,
  type OAuthCallbackErrorCode,
  type OAuthStatusResponse,
} from '../../contracts/oauth.js';
import { createChildLogger, createRootLogger, type AppLogger } from '../../logging/index.js';
import { ConnectTokenError, type ConnectTokenStore } from './connectTokenStore.js';
import { isKnownOAuthProvider } from './oauthProviderRegistry.js';
import type { OAuthService } from './oauthService.js';
import {
  OAuthProviderMismatchError,
  OAuthProviderNotConfiguredError,
} from './oauthService.js';
import { OAuthStateError } from './oauthStateStore.js';

export type OAuthControllerDependencies = {
  service: OAuthService;
  connectTokenStore: ConnectTokenStore;
  logger?: AppLogger;
};

export type OAuthValidationFailure = {
  status: 400;
  body: {
    code: 'validation_error';
    message: string;
  };
};

export type OAuthNotFoundFailure = {
  status: 404;
  body: {
    code: 'provider_not_found';
    message: string;
  };
};

export type OAuthProviderNotConfiguredFailure = {
  status: 400;
  body: {
    code: 'provider_not_configured';
    message: string;
    provider_id: string;
  };
};

export type OAuthUnauthorizedFailure = {
  status: 401;
  body: {
    code: 'invalid_connect_token';
    message: string;
  };
};

export type OAuthStartRedirect = {
  status: 302;
  location: string;
};

export type OAuthConnectTokenSuccess = {
  status: 200;
  body: ConnectTokenResponse;
};

export type OAuthStatusSuccess = {
  status: 200;
  body: OAuthStatusResponse;
};

export type OAuthDisconnectSuccess = {
  status: 204;
  body: undefined;
};

export type OAuthStartResult =
  | OAuthStartRedirect
  | OAuthValidationFailure
  | OAuthUnauthorizedFailure
  | OAuthNotFoundFailure
  | OAuthProviderNotConfiguredFailure;

export type OAuthCallbackResult = OAuthStartRedirect;

export type OAuthStatusResult =
  | OAuthStatusSuccess
  | OAuthValidationFailure
  | OAuthNotFoundFailure;

export type OAuthDisconnectResult =
  | OAuthDisconnectSuccess
  | OAuthValidationFailure
  | OAuthNotFoundFailure;

type HandleOptions = {
  logger?: AppLogger;
};

type KnownProviderGuardOptions = {
  onUnknown: 'json404' | 'connectedRedirect';
};

/** Validates OAuth HTTP requests and delegates to the OAuth service. */
export class OAuthController {
  private readonly service: OAuthService;
  private readonly connectTokenStore: ConnectTokenStore;
  private readonly logger: AppLogger;

  /** Creates a controller with the OAuth service, connect token store, and optional logger. */
  constructor(dependencies: OAuthControllerDependencies) {
    this.service = dependencies.service;
    this.connectTokenStore = dependencies.connectTokenStore;
    this.logger = dependencies.logger ?? createRootLogger();
  }

  /** Mints a short-lived single-use connect token for the authenticated user. */
  handleConnectToken(
    userId: string,
    options: HandleOptions = {},
  ): OAuthConnectTokenSuccess {
    const log = createChildLogger(options.logger ?? this.logger, {
      component: 'oauth.controller',
      user_id: userId,
    });

    const { token, expiresInSeconds } = this.connectTokenStore.create(userId);

    log.info(
      { event: 'oauth.connect_token.created' },
      'OAuth connect token minted',
    );

    return {
      status: 200,
      body: { connect_token: token, expires_in: expiresInSeconds },
    };
  }

  /**
   * Validates params/query, consumes the single-use connect token to derive
   * the user, and returns a redirect to the provider consent URL.
   */
  async handleStart(
    rawParams: unknown,
    rawQuery: unknown,
    options: HandleOptions = {},
  ): Promise<OAuthStartResult> {
    const log = createChildLogger(options.logger ?? this.logger, {
      component: 'oauth.controller',
    });

    const paramsValidation = OAuthProviderIdParamSchema.safeParse(rawParams);
    if (!paramsValidation.success) {
      return validationFailure(log, 'oauth.start.validation_failed', 'Invalid provider id.');
    }

    const queryValidation = OAuthStartQuerySchema.safeParse(rawQuery);
    if (!queryValidation.success) {
      return validationFailure(
        log,
        'oauth.start.validation_failed',
        'Query must include connect_token.',
      );
    }

    const { providerId } = paramsValidation.data;

    let userId: string;
    try {
      ({ userId } = this.connectTokenStore.consume(queryValidation.data.connectToken));
    } catch (error) {
      if (error instanceof ConnectTokenError) {
        log.warn(
          { event: 'oauth.start.invalid_connect_token', reason: error.code },
          'OAuth start connect token rejected',
        );
        return {
          status: 401,
          body: {
            code: 'invalid_connect_token',
            message: 'Connect token is missing, already used, or expired.',
          },
        };
      }
      throw error;
    }

    const providerFailure = assertKnownProvider(log, providerId, 'oauth.start', {
      onUnknown: 'json404',
    });
    if (providerFailure !== undefined) {
      return providerFailure;
    }

    const requestLog = createChildLogger(log, {
      component: 'oauth.controller',
      user_id: userId,
    });

    const result = await this.service.start(userId, providerId);

    if (!result.ok) {
      requestLog.warn(
        { event: 'oauth.start.provider_not_configured', provider_id: providerId },
        'OAuth provider not configured',
      );
      return {
        status: 400,
        body: {
          code: 'provider_not_configured',
          message: `OAuth provider "${providerId}" is not configured.`,
          provider_id: providerId,
        },
      };
    }

    requestLog.info(
      { event: 'oauth.start.succeeded', provider_id: providerId },
      'OAuth start redirect created',
    );

    return { status: 302, location: result.authUrl };
  }

  /**
   * Validates callback params/query, exchanges the authorization code, and redirects
   * the browser to the frontend connected landing page.
   *
   * MVP trust model: the user id is recovered from in-memory OAuth state created at start,
   * not from the callback query. State is single-process only (lost on restart).
   */
  async handleCallback(
    rawParams: unknown,
    rawQuery: unknown,
    options: HandleOptions = {},
  ): Promise<OAuthCallbackResult> {
    const log = createChildLogger(options.logger ?? this.logger, {
      component: 'oauth.controller',
    });

    const providerId = parseProviderIdBestEffort(rawParams);

    const queryValidation = OAuthCallbackQuerySchema.safeParse(rawQuery);
    if (!queryValidation.success) {
      log.warn(
        { event: 'oauth.callback.validation_failed', provider_id: providerId },
        'OAuth callback query validation failed',
      );
      return oauthConnectedRedirect(providerId, 'invalid_callback');
    }

    const query = queryValidation.data;

    if (query.kind === 'error') {
      log.warn(
        {
          event: 'oauth.callback.provider_error',
          provider_id: providerId,
          provider_error: query.error,
        },
        'OAuth provider returned an error on callback',
      );
      return oauthConnectedRedirect(providerId, mapCallbackQueryError(query.error));
    }

    const providerFailure = assertKnownProvider(log, providerId, 'oauth.callback', {
      onUnknown: 'connectedRedirect',
    });
    if (providerFailure !== undefined) {
      return providerFailure;
    }

    const requestLog = createChildLogger(log, {
      component: 'oauth.controller',
    });

    try {
      const { userId } = await this.service.handleCallback(
        providerId,
        query.code,
        query.state,
      );

      requestLog.info(
        {
          event: 'oauth.callback.succeeded',
          user_id: userId,
          provider_id: providerId,
        },
        'OAuth callback succeeded',
      );

      return oauthConnectedRedirect(providerId);
    } catch (error) {
      const errorCode = mapCallbackServiceError(error);

      if (error instanceof OAuthStateError) {
        requestLog.warn(
          {
            event: 'oauth.callback.invalid_state',
            provider_id: providerId,
            reason: error.code,
          },
          'OAuth callback state invalid',
        );
      } else {
        requestLog.warn(
          {
            event: 'oauth.callback.failed',
            provider_id: providerId,
            error_code: errorCode,
            err: error instanceof Error ? error.message : 'callback failed',
          },
          'OAuth callback failed',
        );
      }

      return oauthConnectedRedirect(providerId, errorCode);
    }
  }

  /** Validates params and returns OAuth connection status for the authenticated user. */
  async handleStatus(
    rawParams: unknown,
    userId: string,
    options: HandleOptions = {},
  ): Promise<OAuthStatusResult> {
    const log = createChildLogger(options.logger ?? this.logger, {
      component: 'oauth.controller',
    });

    const paramsValidation = OAuthProviderIdParamSchema.safeParse(rawParams);
    if (!paramsValidation.success) {
      return validationFailure(log, 'oauth.status.validation_failed', 'Invalid provider id.');
    }

    const { providerId } = paramsValidation.data;

    const providerFailure = assertKnownProvider(log, providerId, 'oauth.status', {
      onUnknown: 'json404',
    });
    if (providerFailure !== undefined) {
      return providerFailure;
    }

    const requestLog = createChildLogger(log, {
      component: 'oauth.controller',
      user_id: userId,
    });

    const status = await this.service.getStatus(userId, providerId);
    const body = toOAuthStatusResponse(status);

    requestLog.info(
      {
        event: 'oauth.status.succeeded',
        provider_id: providerId,
        connected: body.connected,
        missing_scope_count: body.missing_scopes.length,
      },
      'OAuth status returned',
    );

    return { status: 200, body };
  }

  /** Validates params and deletes stored OAuth tokens for the authenticated user. */
  async handleDisconnect(
    rawParams: unknown,
    userId: string,
    options: HandleOptions = {},
  ): Promise<OAuthDisconnectResult> {
    const log = createChildLogger(options.logger ?? this.logger, {
      component: 'oauth.controller',
    });

    const paramsValidation = OAuthProviderIdParamSchema.safeParse(rawParams);
    if (!paramsValidation.success) {
      return validationFailure(
        log,
        'oauth.disconnect.validation_failed',
        'Invalid provider id.',
      );
    }

    const { providerId } = paramsValidation.data;

    const providerFailure = assertKnownProvider(log, providerId, 'oauth.disconnect', {
      onUnknown: 'json404',
    });
    if (providerFailure !== undefined) {
      return providerFailure;
    }

    const requestLog = createChildLogger(log, {
      component: 'oauth.controller',
      user_id: userId,
    });

    await this.service.disconnect(userId, providerId);

    requestLog.info(
      { event: 'oauth.disconnect.succeeded', provider_id: providerId },
      'OAuth disconnect completed',
    );

    return { status: 204, body: undefined };
  }
}

/** Returns a 404 when the provider id is not supported (JSON API routes). */
function assertKnownProvider(
  log: AppLogger,
  providerId: string,
  eventPrefix: string,
  options: { onUnknown: 'json404' },
): OAuthNotFoundFailure | undefined;

/** Returns a connected-page redirect when the provider id is not supported (callback). */
function assertKnownProvider(
  log: AppLogger,
  providerId: string,
  eventPrefix: string,
  options: { onUnknown: 'connectedRedirect' },
): OAuthStartRedirect | undefined;

/** Returns a redirect or 404 when the provider id is not supported. */
function assertKnownProvider(
  log: AppLogger,
  providerId: string,
  eventPrefix: string,
  options: KnownProviderGuardOptions,
): OAuthNotFoundFailure | OAuthStartRedirect | undefined {
  if (isKnownOAuthProvider(providerId)) {
    return undefined;
  }

  log.warn(
    { event: `${eventPrefix}.provider_not_found`, provider_id: providerId },
    'OAuth provider not found',
  );

  if (options.onUnknown === 'connectedRedirect') {
    return oauthConnectedRedirect(providerId, 'provider_not_found');
  }

  return {
    status: 404,
    body: {
      code: 'provider_not_found',
      message: `Unknown OAuth provider: ${providerId}`,
    },
  };
}

/** Builds a 302 redirect to the frontend OAuth connected landing page. */
function oauthConnectedRedirect(
  providerId: string,
  error?: OAuthCallbackErrorCode,
): OAuthStartRedirect {
  return { status: 302, location: buildOAuthConnectedRedirectUrl(providerId, error) };
}

/** Parses provider id from route params, falling back to `unknown` when invalid. */
function parseProviderIdBestEffort(rawParams: unknown): string {
  const parsed = OAuthProviderIdParamSchema.safeParse(rawParams);
  if (parsed.success) {
    return parsed.data.providerId;
  }

  return 'unknown';
}

/** Maps provider callback query errors to shared frontend error codes. */
function mapCallbackQueryError(error: string): OAuthCallbackErrorCode {
  if (error === 'access_denied') {
    return 'access_denied';
  }

  return 'invalid_callback';
}

/** Maps service callback failures to shared frontend error codes. */
function mapCallbackServiceError(error: unknown): OAuthCallbackErrorCode {
  if (error instanceof OAuthStateError) {
    return 'invalid_state';
  }

  if (error instanceof OAuthProviderMismatchError) {
    return 'invalid_state';
  }

  if (error instanceof OAuthProviderNotConfiguredError) {
    return 'provider_not_configured';
  }

  return 'token_exchange_failed';
}

/** Logs a validation failure and returns the standard 400 response shape. */
function validationFailure(
  log: AppLogger,
  event: string,
  message: string,
): OAuthValidationFailure {
  log.warn({ event }, 'OAuth request validation failed');
  return {
    status: 400,
    body: {
      code: 'validation_error',
      message,
    },
  };
}
