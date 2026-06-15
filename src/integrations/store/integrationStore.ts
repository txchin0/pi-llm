/** Per-user persisted state for one integration. */
export type UserIntegrationState = {
  enabled: boolean;
  config?: Record<string, unknown>;
};

/** Port for reading and writing per-user integration enablement and config. */
export interface IntegrationStore {
  get(userId: string, id: string): Promise<UserIntegrationState | null>;
  list(userId: string): Promise<Record<string, UserIntegrationState>>;
  set(userId: string, id: string, state: UserIntegrationState): Promise<void>;
}
