import { describe, expect, it } from 'vitest';

import { formatIntegrationGuidance } from '../../src/integrations/formatIntegrationGuidance.js';
import { buildSurfaceSystemPrompt } from '../../src/surface/buildSurfaceSystemPrompt.js';
import { buildWorkerSystemPrompt } from '../../src/worker/buildWorkerSystemPrompt.js';

describe('formatIntegrationGuidance', () => {
  it('returns an empty string when there are no fragments', () => {
    expect(formatIntegrationGuidance([])).toBe('');
  });

  it('joins non-empty fragments with blank lines', () => {
    expect(formatIntegrationGuidance([' first ', '', 'second'])).toBe('first\n\nsecond');
  });
});

describe('buildSurfaceSystemPrompt', () => {
  it('appends integration guidance when provided', () => {
    const prompt = buildSurfaceSystemPrompt(['Use calendar read tools carefully.']);
    expect(prompt).toContain('Use calendar read tools carefully.');
  });
});

describe('buildWorkerSystemPrompt', () => {
  it('appends integration guidance when provided', () => {
    const prompt = buildWorkerSystemPrompt(['Confirm writes with the user policy.']);
    expect(prompt).toContain('Confirm writes with the user policy.');
  });
});
