import type { AgentLlmRole } from '../../config/agentLlm.js';
import type { EnabledIntegration } from '../types.js';

/** Collects OAuth scopes from enabled integrations for one provider and optional role. */
export function aggregateOAuthScopes(
  enabled: EnabledIntegration[],
  providerId: string,
  role?: AgentLlmRole,
): string[] {
  const scopes = new Set<string>();

  for (const { definition } of enabled) {
    const oauth = definition.oauth;
    if (oauth === undefined || oauth.providerId !== providerId) {
      continue;
    }

    if (role !== undefined) {
      addScopes(scopes, oauth.scopes[role]);
      continue;
    }

    for (const roleScopes of Object.values(oauth.scopes)) {
      addScopes(scopes, roleScopes);
    }
  }

  return [...scopes].sort();
}

/** Adds scope strings to the set when the role scope list is present. */
function addScopes(target: Set<string>, roleScopes: string[] | undefined): void {
  if (roleScopes === undefined) {
    return;
  }

  for (const scope of roleScopes) {
    target.add(scope);
  }
}
