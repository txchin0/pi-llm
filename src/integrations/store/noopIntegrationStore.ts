import type { IntegrationStore, UserIntegrationState } from './integrationStore.js';

/** Store that always falls back to integration definition defaults. */
export const noopIntegrationStore: IntegrationStore = {
  get(): Promise<UserIntegrationState | null> {
    return Promise.resolve(null);
  },

  list(): Promise<Record<string, UserIntegrationState>> {
    return Promise.resolve({});
  },

  set(): Promise<void> {
    return Promise.resolve();
  },
};
