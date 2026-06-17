/** Google OAuth client credentials sourced from environment variables. */
export type GoogleOAuthConfig = {
  /** Google OAuth client id. */
  clientId: string;
  /** Google OAuth client secret. */
  clientSecret: string;
  /** Registered redirect URI for the OAuth callback route. */
  redirectUri: string;
};

/** Returns Google OAuth settings when all required env vars are set; otherwise `undefined`. */
export function parseGoogleOAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GoogleOAuthConfig | undefined {
  const clientId = environment.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = environment.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = environment.GOOGLE_OAUTH_REDIRECT_URI?.trim();

  if (!clientId || !clientSecret || !redirectUri) {
    return undefined;
  }

  return { clientId, clientSecret, redirectUri };
}
