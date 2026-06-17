/** Persisted OAuth token set for one provider. */
export type StoredOAuthToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs: number;
  scopes: string[];
};

/** Port for reading and writing per-user OAuth tokens by provider. */
export interface OAuthTokenStore {
  get(userId: string, providerId: string): Promise<StoredOAuthToken | null>;
  set(userId: string, providerId: string, token: StoredOAuthToken): Promise<void>;
  delete(userId: string, providerId: string): Promise<void>;
}
