import { createHash, randomBytes } from 'node:crypto';

import { createChildLogger } from '../../logging/createChildLogger.js';
import type { AppLogger } from '../../logging/types.js';
import { resolveEnabledIntegrations } from '../resolveEnabledIntegrations.js';
import type { IntegrationStore } from '../store/integrationStore.js';
import type { OAuthProviderDefinition } from './oauthProvider.js';
import {
  createInMemoryOAuthStateStore,
  type OAuthStateStore,
} from './oauthStateStore.js';
import { aggregateOAuthScopes } from './scopeAggregation.js';
import type { OAuthTokenStore, StoredOAuthToken } from './oauthTokenStore.js';

const REFRESH_SKEW_MS = 60_000;

/** Reason a user is not connected for OAuth token access. */
export type OAuthNotConnectedReason =
  | 'not_connected'
  | 'missing_scopes'
  | 'refresh_failed';

/** Thrown when callback route provider id does not match the stored OAuth state entry. */
export class OAuthProviderMismatchError extends Error {
  readonly providerId: string;
  readonly expectedProviderId: string;

  /** Carries the route param and the provider id bound into OAuth state at start. */
  constructor(providerId: string, expectedProviderId: string) {
    super(
      `OAuth callback provider mismatch: expected ${expectedProviderId}, got ${providerId}`,
    );
    this.name = 'OAuthProviderMismatchError';
    this.providerId = providerId;
    this.expectedProviderId = expectedProviderId;
  }
}

/** Thrown when a known provider id has no configured OAuth provider at callback time. */
export class OAuthProviderNotConfiguredError extends Error {
  readonly providerId: string;

  /** Identifies the provider that was not configured when the callback ran. */
  constructor(providerId: string) {
    super(`OAuth provider not configured: ${providerId}`);
    this.name = 'OAuthProviderNotConfiguredError';
    this.providerId = providerId;
  }
}

/** Thrown when OAuth tokens are missing, insufficient, or cannot be refreshed. */
export class OAuthNotConnectedError extends Error {
  readonly providerId: string;
  readonly userId: string;
  readonly reason: OAuthNotConnectedReason;
  readonly missingScopes: string[];

  /** Carries provider and user context for building a connect URL in callers. */
  constructor(options: {
    providerId: string;
    userId: string;
    reason: OAuthNotConnectedReason;
    missingScopes?: string[];
  }) {
    const { providerId, userId, reason, missingScopes = [] } = options;
    super(buildOAuthNotConnectedMessage(providerId, reason, missingScopes));
    this.name = 'OAuthNotConnectedError';
    this.providerId = providerId;
    this.userId = userId;
    this.reason = reason;
    this.missingScopes = missingScopes;
  }
}

export type OAuthStartResult =
  | { ok: true; authUrl: string }
  | { ok: false; code: 'provider_not_configured'; providerId: string };

export type OAuthStatus = {
  connected: boolean;
  grantedScopes: string[];
  missingScopes: string[];
};

export type OAuthServiceDependencies = {
  tokenStore: OAuthTokenStore;
  integrationStore: IntegrationStore;
  getOAuthProvider: (providerId: string) => OAuthProviderDefinition | undefined;
  stateStore?: OAuthStateStore;
  log?: AppLogger;
};

export type OAuthService = {
  /** Starts the OAuth consent flow and returns the provider authorization URL. */
  start(userId: string, providerId: string): Promise<OAuthStartResult>;
  /** Exchanges an authorization code and persists tokens for the user. */
  handleCallback(
    providerId: string,
    code: string,
    state: string,
  ): Promise<{ userId: string }>;
  /** Returns a valid access token, refreshing when near expiry. */
  getAccessToken(
    userId: string,
    providerId: string,
    requiredScopes: string[],
  ): Promise<string>;
  /** Reports connection state and scope coverage for enabled integrations. */
  getStatus(userId: string, providerId: string): Promise<OAuthStatus>;
  /**
   * Deletes stored tokens for the user and provider.
   * Does not revoke tokens at the provider in the MVP.
   */
  disconnect(userId: string, providerId: string): Promise<void>;
};

/** Creates the shared OAuth service for connect, callback, and token access. */
export function createOAuthService(
  dependencies: OAuthServiceDependencies,
): OAuthService {
  const {
    tokenStore,
    integrationStore,
    getOAuthProvider,
    stateStore = createInMemoryOAuthStateStore(),
    log,
  } = dependencies;

  const serviceLog =
    log !== undefined
      ? createChildLogger(log, { component: 'oauth_service' })
      : undefined;

  const refreshFlights = new Map<string, Promise<string>>();

  return {
    async start(userId, providerId) {
      const provider = getOAuthProvider(providerId);
      if (provider === undefined) {
        serviceLog?.info(
          { event: 'oauth.start.provider_not_configured', provider_id: providerId },
          'OAuth provider not configured',
        );
        return { ok: false, code: 'provider_not_configured', providerId };
      }

      const enabled = await resolveEnabledIntegrations(
        integrationStore,
        userId,
        serviceLog === undefined ? {} : { log: serviceLog },
      );
      const scopes = aggregateOAuthScopes(enabled, providerId);
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = deriveCodeChallenge(codeVerifier);
      const state = generateOpaqueValue();

      stateStore.create({
        state,
        userId,
        providerId,
        codeVerifier,
      });

      const authUrl = provider.buildAuthUrl({
        scopes,
        state,
        codeChallenge,
      });

      serviceLog?.info(
        {
          event: 'oauth.start.created',
          user_id: userId,
          provider_id: providerId,
          scope_count: scopes.length,
        },
        'OAuth consent URL created',
      );

      return { ok: true, authUrl };
    },

    async handleCallback(providerId, code, state) {
      const entry = stateStore.consume(state);
      if (entry.providerId !== providerId) {
        throw new OAuthProviderMismatchError(providerId, entry.providerId);
      }

      const provider = getOAuthProvider(providerId);
      if (provider === undefined) {
        throw new OAuthProviderNotConfiguredError(providerId);
      }

      const tokens = await provider.exchangeCode({
        code,
        codeVerifier: entry.codeVerifier,
      });

      const existing = await tokenStore.get(entry.userId, providerId);
      const stored: StoredOAuthToken = {
        accessToken: tokens.accessToken,
        expiresAtMs: tokens.expiresAtMs,
        scopes:
          tokens.scopes.length > 0
            ? tokens.scopes
            : (existing?.scopes ?? []),
        ...(tokens.refreshToken !== undefined
          ? { refreshToken: tokens.refreshToken }
          : existing?.refreshToken !== undefined
            ? { refreshToken: existing.refreshToken }
            : {}),
      };

      await tokenStore.set(entry.userId, providerId, stored);

      serviceLog?.info(
        {
          event: 'oauth.callback.completed',
          user_id: entry.userId,
          provider_id: providerId,
          scope_count: stored.scopes.length,
        },
        'OAuth callback completed',
      );

      return { userId: entry.userId };
    },

    async getAccessToken(userId, providerId, requiredScopes) {
      const stored = await tokenStore.get(userId, providerId);
      if (stored === null) {
        throw new OAuthNotConnectedError({
          providerId,
          userId,
          reason: 'not_connected',
        });
      }

      const missingRequired = findMissingScopes(requiredScopes, stored.scopes);
      if (missingRequired.length > 0) {
        throw new OAuthNotConnectedError({
          providerId,
          userId,
          reason: 'missing_scopes',
          missingScopes: missingRequired,
        });
      }

      if (!isAccessTokenExpired(stored.expiresAtMs)) {
        return stored.accessToken;
      }

      if (stored.refreshToken === undefined || stored.refreshToken === '') {
        throw new OAuthNotConnectedError({
          providerId,
          userId,
          reason: 'not_connected',
        });
      }

      const flightKey = refreshFlightKey(userId, providerId);
      const inFlight = refreshFlights.get(flightKey);
      if (inFlight !== undefined) {
        return inFlight;
      }

      const refreshPromise = refreshAndPersistAccessToken({
        userId,
        providerId,
        refreshToken: stored.refreshToken,
        priorScopes: stored.scopes,
        getOAuthProvider,
        tokenStore,
        ...(serviceLog === undefined ? {} : { serviceLog }),
      }).finally(() => {
        refreshFlights.delete(flightKey);
      });

      refreshFlights.set(flightKey, refreshPromise);
      return refreshPromise;
    },

    async getStatus(userId, providerId) {
      const stored = await tokenStore.get(userId, providerId);
      const enabled = await resolveEnabledIntegrations(
        integrationStore,
        userId,
        serviceLog === undefined ? {} : { log: serviceLog },
      );
      const consentScopes = aggregateOAuthScopes(enabled, providerId);
      const grantedScopes = stored?.scopes ?? [];

      return {
        connected: stored !== null,
        grantedScopes,
        missingScopes: findMissingScopes(consentScopes, grantedScopes),
      };
    },

    async disconnect(userId, providerId) {
      await tokenStore.delete(userId, providerId);
      serviceLog?.info(
        { event: 'oauth.disconnect', user_id: userId, provider_id: providerId },
        'OAuth tokens deleted',
      );
    },
  };
}

type RefreshAndPersistInput = {
  userId: string;
  providerId: string;
  refreshToken: string;
  priorScopes: string[];
  getOAuthProvider: (providerId: string) => OAuthProviderDefinition | undefined;
  tokenStore: OAuthTokenStore;
  serviceLog?: AppLogger;
};

/** Refreshes an access token and persists the updated token set. */
async function refreshAndPersistAccessToken(
  input: RefreshAndPersistInput,
): Promise<string> {
  const {
    userId,
    providerId,
    refreshToken,
    priorScopes,
    getOAuthProvider,
    tokenStore,
    serviceLog,
  } = input;

  const provider = getOAuthProvider(providerId);
  if (provider === undefined) {
    await tokenStore.delete(userId, providerId);
    throw new OAuthNotConnectedError({
      providerId,
      userId,
      reason: 'refresh_failed',
    });
  }

  try {
    const refreshed = await provider.refreshTokens({ refreshToken });
    const stored: StoredOAuthToken = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? refreshToken,
      expiresAtMs: refreshed.expiresAtMs,
      scopes:
        refreshed.scopes.length > 0 ? refreshed.scopes : priorScopes,
    };
    await tokenStore.set(userId, providerId, stored);

    serviceLog?.info(
      {
        event: 'oauth.token.refreshed',
        user_id: userId,
        provider_id: providerId,
      },
      'OAuth access token refreshed',
    );

    return stored.accessToken;
  } catch (error) {
    await tokenStore.delete(userId, providerId);
    serviceLog?.warn(
      {
        event: 'oauth.token.refresh_failed',
        user_id: userId,
        provider_id: providerId,
        err: error instanceof Error ? error.message : 'refresh failed',
      },
      'OAuth token refresh failed',
    );
    throw new OAuthNotConnectedError({
      providerId,
      userId,
      reason: 'refresh_failed',
    });
  }
}

/** Returns whether the access token is expired or within the refresh skew window. */
function isAccessTokenExpired(expiresAtMs: number): boolean {
  return expiresAtMs <= Date.now() + REFRESH_SKEW_MS;
}

/** Returns scopes from `required` that are not present in `granted`. */
function findMissingScopes(required: string[], granted: string[]): string[] {
  const grantedSet = new Set(granted);
  return required.filter((scope) => !grantedSet.has(scope));
}

/** Builds the in-flight refresh map key for one user and provider. */
function refreshFlightKey(userId: string, providerId: string): string {
  return `${userId}:${providerId}`;
}

/** Generates a PKCE code verifier. */
function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** Derives the S256 PKCE code challenge from a verifier. */
function deriveCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

/** Generates an opaque OAuth state value. */
function generateOpaqueValue(): string {
  return randomBytes(32).toString('base64url');
}

/** Builds a human-readable OAuth not-connected error message. */
function buildOAuthNotConnectedMessage(
  providerId: string,
  reason: OAuthNotConnectedReason,
  missingScopes: string[],
): string {
  switch (reason) {
    case 'not_connected':
      return `OAuth provider "${providerId}" is not connected`;
    case 'missing_scopes':
      return `OAuth provider "${providerId}" is missing scopes: ${missingScopes.join(', ')}`;
    case 'refresh_failed':
      return `OAuth provider "${providerId}" token refresh failed`;
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}
