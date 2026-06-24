import { OAuthNotConnectedError } from '../oauth/oauthService.js';

/** Google integration product label for connect messaging. */
export type GoogleProductLabel = 'Calendar' | 'Tasks';

/** Builds the OAuth connect URL for a user and provider. */
export function buildOAuthConnectUrl(userId: string, providerId: string): string {
  return `/v1/oauth/${providerId}/start?user_id=${encodeURIComponent(userId)}`;
}

/** Returns user-facing text instructing them to connect Google OAuth for a product. */
export function formatGoogleConnectMessage(
  userId: string,
  product: GoogleProductLabel,
  providerId = 'google',
): string {
  const url = buildOAuthConnectUrl(userId, providerId);
  return `Google ${product} is not connected. Connect Google at ${url} (reconnect grants all enabled Google integration scopes).`;
}

/** Maps OAuth not-connected failures to connect instructions, or null when unrelated. */
export function formatGoogleConnectError(
  error: unknown,
  userId: string,
  product: GoogleProductLabel,
): string | null {
  if (error instanceof OAuthNotConnectedError) {
    return formatGoogleConnectMessage(userId, product, error.providerId);
  }
  return null;
}
