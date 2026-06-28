import { parseGoogleOAuthConfig } from '../../config/googleOAuth.js';
import type * as GoogleApis from 'googleapis';

type GoogleApisModule = typeof GoogleApis;

let loadPromise: Promise<GoogleApisModule> | undefined;

/** Returns the cached googleapis module, loading it on first call. */
export function loadGoogleApis(): Promise<GoogleApisModule> {
  loadPromise ??= import('googleapis');
  return loadPromise;
}

/**
 * Startup hook: warms googleapis when Google OAuth is configured so the first
 * Calendar/Tasks tool call avoids import latency. No-op when Google OAuth env
 * vars are absent. Idempotent (load is cached). A broken googleapis install now
 * fails fast at server startup instead of on the first tool call.
 */
export async function warmGoogleApisIfConfigured(): Promise<void> {
  if (parseGoogleOAuthConfig() === undefined) {
    return;
  }
  await loadGoogleApis();
}

/** Builds an authenticated googleapis OAuth2 client for a bearer access token. */
export async function createGoogleAuth(accessToken: string) {
  const { google } = await loadGoogleApis();
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return { google, auth };
}
