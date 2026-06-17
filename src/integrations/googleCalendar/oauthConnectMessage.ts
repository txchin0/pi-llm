import { OAuthNotConnectedError } from '../oauth/oauthService.js';

/** Builds the OAuth connect URL for a user and provider. */
export function buildOAuthConnectUrl(userId: string, providerId: string): string {
  return `/v1/oauth/${providerId}/start?user_id=${encodeURIComponent(userId)}`;
}

/** Returns user-facing text instructing them to connect Google OAuth. */
export function formatOAuthConnectMessage(userId: string, providerId = 'google'): string {
  const url = buildOAuthConnectUrl(userId, providerId);
  return `Google Calendar is not connected. Connect Google at ${url}`;
}

/** Maps OAuth not-connected failures to connect instructions, or null when unrelated. */
export function formatOAuthConnectError(error: unknown, userId: string): string | null {
  if (error instanceof OAuthNotConnectedError) {
    return formatOAuthConnectMessage(userId, error.providerId);
  }
  return null;
}
