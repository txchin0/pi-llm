import { describe, expect, it } from 'vitest';

import { aggregateOAuthScopes } from '../../../src/integrations/oauth/scopeAggregation.js';
import type {
  EnabledIntegration,
  IntegrationDefinition,
} from '../../../src/integrations/types.js';

function mockDefinition(
  id: string,
  oauth?: IntegrationDefinition['oauth'],
): IntegrationDefinition {
  return {
    id,
    label: id,
    defaultEnabled: true,
    tools: {},
    ...(oauth === undefined ? {} : { oauth }),
  };
}

function enabled(
  definition: IntegrationDefinition,
): EnabledIntegration {
  return { definition, config: {} };
}

describe('aggregateOAuthScopes', () => {
  it('returns the consent union across all roles when role is omitted', () => {
    const integrations = [
      enabled(
        mockDefinition('google_calendar', {
          providerId: 'google',
          scopes: {
            surface: ['calendar.readonly'],
            worker: ['calendar.events'],
          },
        }),
      ),
    ];

    expect(aggregateOAuthScopes(integrations, 'google')).toEqual([
      'calendar.events',
      'calendar.readonly',
    ]);
  });

  it('returns only the requested role scopes when role is given', () => {
    const integrations = [
      enabled(
        mockDefinition('google_calendar', {
          providerId: 'google',
          scopes: {
            surface: ['calendar.readonly'],
            worker: ['calendar.events'],
          },
        }),
      ),
    ];

    expect(aggregateOAuthScopes(integrations, 'google', 'surface')).toEqual([
      'calendar.readonly',
    ]);
    expect(aggregateOAuthScopes(integrations, 'google', 'worker')).toEqual([
      'calendar.events',
    ]);
  });

  it('de-duplicates scopes across integrations and roles', () => {
    const integrations = [
      enabled(
        mockDefinition('google_calendar', {
          providerId: 'google',
          scopes: {
            surface: ['calendar.readonly', 'openid'],
            worker: ['calendar.events', 'openid'],
          },
        }),
      ),
      enabled(
        mockDefinition('google_tasks', {
          providerId: 'google',
          scopes: {
            surface: ['tasks.readonly', 'openid'],
          },
        }),
      ),
    ];

    expect(aggregateOAuthScopes(integrations, 'google')).toEqual([
      'calendar.events',
      'calendar.readonly',
      'openid',
      'tasks.readonly',
    ]);
  });

  it('ignores integrations without oauth or for other providers', () => {
    const integrations = [
      enabled(mockDefinition('no_oauth')),
      enabled(
        mockDefinition('other_provider', {
          providerId: 'microsoft',
          scopes: { surface: ['calendars.read'] },
        }),
      ),
      enabled(
        mockDefinition('google_calendar', {
          providerId: 'google',
          scopes: { surface: ['calendar.readonly'] },
        }),
      ),
    ];

    expect(aggregateOAuthScopes(integrations, 'google')).toEqual([
      'calendar.readonly',
    ]);
  });

  it('returns an empty array when no enabled integration declares the provider', () => {
    const integrations = [
      enabled(
        mockDefinition('google_calendar', {
          providerId: 'google',
          scopes: { surface: ['calendar.readonly'] },
        }),
      ),
    ];

    expect(aggregateOAuthScopes(integrations, 'microsoft')).toEqual([]);
  });
});
