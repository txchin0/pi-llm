import type {
  IntegrationStore,
  UserIntegrationState,
} from '../../src/integrations/store/integrationStore.js';

/** Minimal {@link IntegrationStore} stub that always falls back to definition defaults. */
export function createEmptyIntegrationStore(
  overrides: Partial<IntegrationStore> = {},
): IntegrationStore {
  return {
    get(): Promise<UserIntegrationState | null> {
      return Promise.resolve(null);
    },
    list(): Promise<Record<string, UserIntegrationState>> {
      return Promise.resolve({});
    },
    set(): Promise<void> {
      return Promise.resolve();
    },
    setMany(): Promise<void> {
      return Promise.resolve();
    },
    ...overrides,
  };
}
