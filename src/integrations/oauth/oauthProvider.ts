import {
  CodeChallengeMethod,
  OAuth2Client,
  type Credentials,
} from 'google-auth-library';

import type { GoogleOAuthConfig } from '../../config/googleOAuth.js';

/** Token set returned by code exchange or refresh. */
export type OAuthTokens = {
  /** Bearer access token for provider API calls. */
  accessToken: string;
  /** Long-lived refresh token when offline access was granted. */
  refreshToken?: string;
  /** Access token expiry as epoch milliseconds. */
  expiresAtMs: number;
  /** OAuth scopes granted for the token set. */
  scopes: string[];
};

/** Inputs for building a provider consent URL with PKCE. */
export type BuildAuthUrlInput = {
  /** Scopes to request on the consent screen. */
  scopes: string[];
  /** Opaque state value echoed on callback for CSRF protection. */
  state: string;
  /** PKCE S256 code challenge derived from the stored verifier. */
  codeChallenge: string;
};

/** Inputs for exchanging an authorization code for tokens. */
export type ExchangeCodeInput = {
  /** Authorization code from the provider callback. */
  code: string;
  /** PKCE code verifier paired with the consent URL challenge. */
  codeVerifier: string;
};

/** Inputs for refreshing an access token. */
export type RefreshTokensInput = {
  /** Stored refresh token for the user and provider. */
  refreshToken: string;
};

/** Provider-agnostic OAuth operations used by the shared OAuth service layer. */
export type OAuthProviderDefinition = {
  /** Stable provider id (for example `google`). */
  id: string;
  /** Builds the provider consent URL with offline refresh and incremental scope params. */
  buildAuthUrl(input: BuildAuthUrlInput): string;
  /** Exchanges an authorization code and PKCE verifier for tokens. */
  exchangeCode(input: ExchangeCodeInput): Promise<OAuthTokens>;
  /** Obtains a new access token using a refresh token. */
  refreshTokens(input: RefreshTokensInput): Promise<OAuthTokens>;
};

/** Creates a Google OAuth provider backed by `google-auth-library`'s `OAuth2Client`. */
export function createGoogleOAuthProvider(
  config: GoogleOAuthConfig,
): OAuthProviderDefinition {
  const sharedClient = createOAuth2Client(config);

  return {
    id: 'google',

    buildAuthUrl({ scopes, state, codeChallenge }) {
      return sharedClient.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: true,
        scope: scopes,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
      });
    },

    async exchangeCode({ code, codeVerifier }) {
      const client = createOAuth2Client(config);
      const { tokens } = await client.getToken({ code, codeVerifier });
      return mapCredentialsToOAuthTokens(tokens);
    },

    async refreshTokens({ refreshToken }) {
      const client = createOAuth2Client(config);
      client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await client.refreshAccessToken();
      const merged: Credentials = {
        ...credentials,
        refresh_token: credentials.refresh_token ?? refreshToken,
      };
      return mapCredentialsToOAuthTokens(merged);
    },
  };
}

/** Builds an `OAuth2Client` for the given Google OAuth app credentials. */
function createOAuth2Client(config: GoogleOAuthConfig): OAuth2Client {
  return new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
  });
}

/** Normalizes `google-auth-library` credentials into `OAuthTokens`. */
function mapCredentialsToOAuthTokens(credentials: Credentials): OAuthTokens {
  const accessToken = credentials.access_token;
  if (accessToken === undefined || accessToken === null || accessToken === '') {
    throw new Error('OAuth token response missing access_token');
  }

  const expiresAtMs = credentials.expiry_date ?? Date.now();
  const scopes = parseScopeString(credentials.scope);
  const tokens: OAuthTokens = {
    accessToken,
    expiresAtMs,
    scopes,
  };

  if (
    credentials.refresh_token !== undefined &&
    credentials.refresh_token !== null &&
    credentials.refresh_token !== ''
  ) {
    tokens.refreshToken = credentials.refresh_token;
  }

  return tokens;
}

/** Splits a space-delimited OAuth scope string into individual scopes. */
function parseScopeString(scope: string | undefined): string[] {
  if (scope === undefined || scope.trim() === '') {
    return [];
  }

  return scope.trim().split(/\s+/);
}
