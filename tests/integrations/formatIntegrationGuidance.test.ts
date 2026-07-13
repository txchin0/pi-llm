import { describe, expect, it } from 'vitest';

import { formatIntegrationGuidance } from '../../src/integrations/formatIntegrationGuidance.js';

describe('formatIntegrationGuidance', () => {
  it('returns an empty string when there are no fragments', () => {
    expect(formatIntegrationGuidance([])).toBe('');
  });

  it('joins non-empty fragments with blank lines', () => {
    expect(formatIntegrationGuidance([' first ', '', 'second'])).toBe('first\n\nsecond');
  });
});
