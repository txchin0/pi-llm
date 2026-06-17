import type { OAuthTokenStore } from './oauthTokenStore.js';

/** Store that never persists OAuth tokens. */
export const noopOAuthTokenStore: OAuthTokenStore = {
  get(): Promise<null> {
    return Promise.resolve(null);
  },

  set(): Promise<void> {
    return Promise.resolve();
  },

  delete(): Promise<void> {
    return Promise.resolve();
  },
};
