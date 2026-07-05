import { OAuthNotConnectedError } from '../oauth/oauthService.js';

/** Google integration product label for connect messaging. */
export type GoogleProductLabel = 'Calendar' | 'Tasks';

/**
 * Returns user-facing text telling the user to connect Google for a product.
 *
 * Deliberately not a link: OAuth `/start` now requires a single-use connect
 * token minted by an authenticated request, so a static URL embedded in chat
 * cannot work. Users connect from the app's Settings, which mints the token
 * and performs the redirect.
 */
export function formatGoogleConnectMessage(product: GoogleProductLabel): string {
  return `Google ${product} is not connected. Open Settings in the app and connect Google to enable it (reconnecting grants all enabled Google integration scopes).`;
}

/** Maps OAuth not-connected failures to connect instructions, or null when unrelated. */
export function formatGoogleConnectError(
  error: unknown,
  product: GoogleProductLabel,
): string | null {
  if (error instanceof OAuthNotConnectedError) {
    return formatGoogleConnectMessage(product);
  }
  return null;
}
