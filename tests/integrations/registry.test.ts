import { describe, expect, it } from 'vitest';

import { assertToolAllowlistSync } from '../../src/integrations/assertToolAllowlistSync.js';
import { SURFACE_BASE_TOOLS } from '../../src/integrations/baseTools.js';
import {
  validateIntegrationOAuth,
  validateRegistry,
} from '../../src/integrations/registry.js';
import type { IntegrationDefinition } from '../../src/integrations/types.js';

function createOAuthTestDefinition(
  overrides: Partial<IntegrationDefinition> = {},
): IntegrationDefinition {
  return {
    id: 'oauth_test',
    label: 'OAuth Test',
    defaultEnabled: true,
    oauth: {
      providerId: 'google',
      scopes: {
        surface: ['calendar.readonly'],
        worker: ['calendar.events'],
      },
    },
    tools: {
      surface: [
        {
          name: 'oauth_read',
          register() {},
        },
      ],
      worker: [
        {
          name: 'oauth_write',
          register() {},
        },
      ],
    },
    ...overrides,
  };
}

describe('validateRegistry', () => {
  it('accepts the current integration registry', () => {
    expect(() => validateRegistry()).not.toThrow();
  });
});

describe('validateIntegrationOAuth', () => {
  it('accepts a valid oauth declaration', () => {
    expect(() => validateIntegrationOAuth(createOAuthTestDefinition())).not.toThrow();
  });

  it('rejects an unknown oauth provider id', () => {
    const definition = createOAuthTestDefinition({
      oauth: {
        providerId: 'unknown_provider',
        scopes: { surface: ['scope.a'] },
      },
    });

    expect(() => validateIntegrationOAuth(definition)).toThrow(
      'declares unknown OAuth provider "unknown_provider"',
    );
  });

  it('rejects oauth declared without any tools', () => {
    const definition = createOAuthTestDefinition({ tools: {} });

    expect(() => validateIntegrationOAuth(definition)).toThrow(
      'declares oauth but has no tools',
    );
  });

  it('rejects oauth when a role with tools has no scopes', () => {
    const definition = createOAuthTestDefinition({
      oauth: {
        providerId: 'google',
        scopes: { worker: ['calendar.events'] },
      },
    });

    expect(() => validateIntegrationOAuth(definition)).toThrow(
      'declares oauth but has no scopes for role "surface"',
    );
  });
});

describe('assertToolAllowlistSync', () => {
  it('throws when an integration tool collides with a base tool', () => {
    expect(() => assertToolAllowlistSync(SURFACE_BASE_TOOLS, ['read'])).toThrow(
      'collides with a base tool',
    );
  });

  it('throws on duplicate integration tool names', () => {
    expect(() => assertToolAllowlistSync(SURFACE_BASE_TOOLS, ['web_search', 'web_search'])).toThrow(
      'Duplicate integration tool name',
    );
  });
});
