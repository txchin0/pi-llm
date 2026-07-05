import {
  LoginRequestSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
  type AuthTokensResponse,
} from '../contracts/auth.js';
import { createChildLogger, createRootLogger, type AppLogger } from '../logging/index.js';
import { AuthError, type AuthService, type AuthTokens } from './authService.js';

export type AuthControllerDependencies = {
  service: AuthService;
  logger?: AppLogger;
};

export type AuthSuccess = {
  status: 200 | 201;
  body: AuthTokensResponse;
};

export type AuthFailure = {
  status: 400 | 401 | 409;
  body: {
    code: 'validation_error' | 'user_exists' | 'invalid_credentials' | 'invalid_refresh_token';
    message: string;
  };
};

export type AuthResult = AuthSuccess | AuthFailure;

export type LogoutResult =
  | { status: 204; body: undefined }
  | AuthFailure;

type HandleOptions = {
  logger?: AppLogger;
};

/** Maps issued tokens to the public snake_case response shape. */
function toTokensResponse(tokens: AuthTokens): AuthTokensResponse {
  return {
    user_id: tokens.userId,
    token_type: 'Bearer',
    access_token: tokens.accessToken,
    expires_in: tokens.expiresIn,
    refresh_token: tokens.refreshToken,
  };
}

/** Maps expected auth service failures to HTTP status + body. */
function toAuthFailure(error: AuthError): AuthFailure {
  switch (error.code) {
    case 'user_exists':
      return { status: 409, body: { code: 'user_exists', message: error.message } };
    case 'invalid_credentials':
      return {
        status: 401,
        body: { code: 'invalid_credentials', message: error.message },
      };
    case 'invalid_refresh_token':
      return {
        status: 401,
        body: { code: 'invalid_refresh_token', message: error.message },
      };
    default: {
      const _exhaustive: never = error.code;
      return _exhaustive;
    }
  }
}

/** Validates auth HTTP requests and delegates to the auth service. */
export class AuthController {
  private readonly service: AuthService;
  private readonly logger: AppLogger;

  /** Creates a controller with the auth service and optional logger. */
  constructor(dependencies: AuthControllerDependencies) {
    this.service = dependencies.service;
    this.logger = dependencies.logger ?? createRootLogger();
  }

  /** Creates an account and returns the first token pair. */
  async handleRegister(rawBody: unknown, options: HandleOptions = {}): Promise<AuthResult> {
    const log = createChildLogger(options.logger ?? this.logger, {
      component: 'auth.controller',
    });

    const validation = RegisterRequestSchema.safeParse(rawBody);
    if (!validation.success) {
      log.warn({ event: 'auth.register.validation_failed' }, 'register validation failed');
      return {
        status: 400,
        body: {
          code: 'validation_error',
          message: validation.error.issues[0]?.message ?? 'Invalid register request.',
        },
      };
    }

    try {
      const tokens = await this.service.register(
        validation.data.user_id,
        validation.data.password,
      );
      log.info(
        { event: 'auth.register.succeeded', user_id: tokens.userId },
        'account registered',
      );
      return { status: 201, body: toTokensResponse(tokens) };
    } catch (error) {
      if (error instanceof AuthError) {
        log.warn(
          { event: 'auth.register.failed', code: error.code },
          'register failed',
        );
        return toAuthFailure(error);
      }
      throw error;
    }
  }

  /** Verifies credentials and returns a new token pair. */
  async handleLogin(rawBody: unknown, options: HandleOptions = {}): Promise<AuthResult> {
    const log = createChildLogger(options.logger ?? this.logger, {
      component: 'auth.controller',
    });

    const validation = LoginRequestSchema.safeParse(rawBody);
    if (!validation.success) {
      log.warn({ event: 'auth.login.validation_failed' }, 'login validation failed');
      return {
        status: 400,
        body: {
          code: 'validation_error',
          message: 'Body must include user_id and password.',
        },
      };
    }

    try {
      const tokens = await this.service.login(
        validation.data.user_id,
        validation.data.password,
      );
      log.info({ event: 'auth.login.succeeded', user_id: tokens.userId }, 'login succeeded');
      return { status: 200, body: toTokensResponse(tokens) };
    } catch (error) {
      if (error instanceof AuthError) {
        log.warn({ event: 'auth.login.failed', code: error.code }, 'login failed');
        return toAuthFailure(error);
      }
      throw error;
    }
  }

  /** Exchanges a refresh token for a new pair (rotating the old one). */
  async handleRefresh(rawBody: unknown, options: HandleOptions = {}): Promise<AuthResult> {
    const log = createChildLogger(options.logger ?? this.logger, {
      component: 'auth.controller',
    });

    const validation = RefreshRequestSchema.safeParse(rawBody);
    if (!validation.success) {
      log.warn({ event: 'auth.refresh.validation_failed' }, 'refresh validation failed');
      return {
        status: 400,
        body: {
          code: 'validation_error',
          message: 'Body must include refresh_token.',
        },
      };
    }

    try {
      const tokens = await this.service.refresh(validation.data.refresh_token);
      log.info(
        { event: 'auth.refresh.succeeded', user_id: tokens.userId },
        'tokens refreshed',
      );
      return { status: 200, body: toTokensResponse(tokens) };
    } catch (error) {
      if (error instanceof AuthError) {
        log.warn({ event: 'auth.refresh.failed', code: error.code }, 'refresh failed');
        return toAuthFailure(error);
      }
      throw error;
    }
  }

  /** Revokes the presented refresh token. */
  async handleLogout(rawBody: unknown, options: HandleOptions = {}): Promise<LogoutResult> {
    const log = createChildLogger(options.logger ?? this.logger, {
      component: 'auth.controller',
    });

    const validation = RefreshRequestSchema.safeParse(rawBody);
    if (!validation.success) {
      log.warn({ event: 'auth.logout.validation_failed' }, 'logout validation failed');
      return {
        status: 400,
        body: {
          code: 'validation_error',
          message: 'Body must include refresh_token.',
        },
      };
    }

    await this.service.logout(validation.data.refresh_token);
    log.info({ event: 'auth.logout.succeeded' }, 'refresh token revoked');
    return { status: 204, body: undefined };
  }
}
