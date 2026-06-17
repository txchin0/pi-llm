import { parseGoogleOAuthConfig } from '../../config/googleOAuth.js';
import {
  createGoogleOAuthProvider,
  type OAuthProviderDefinition,
} from './oauthProvider.js';

/** Provider ids that may be registered when env credentials are present. */
export const KNOWN_OAUTH_PROVIDER_IDS = ['google'] as const;

const oauthProviderRegistry = new Map<string, OAuthProviderDefinition>();

const googleOAuthConfig = parseGoogleOAuthConfig();
if (googleOAuthConfig !== undefined) {
  oauthProviderRegistry.set('google', createGoogleOAuthProvider(googleOAuthConfig));
}

/** Registered OAuth provider definitions keyed by provider id. */
export { oauthProviderRegistry };

/** Returns a registered OAuth provider definition by id, when configured. */
export function getOAuthProvider(
  providerId: string,
): OAuthProviderDefinition | undefined {
  return oauthProviderRegistry.get(providerId);
}

/** Returns whether `providerId` is a supported OAuth provider (configured or not). */
export function isKnownOAuthProvider(providerId: string): boolean {
  return (KNOWN_OAUTH_PROVIDER_IDS as readonly string[]).includes(providerId);
}
