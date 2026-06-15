import { describe, expect, it } from 'vitest';

import { assertToolAllowlistSync } from '../../src/integrations/assertToolAllowlistSync.js';
import { SURFACE_BASE_TOOLS } from '../../src/integrations/baseTools.js';
import { validateRegistry } from '../../src/integrations/registry.js';

describe('validateRegistry', () => {
  it('accepts the current integration registry', () => {
    expect(() => validateRegistry()).not.toThrow();
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
