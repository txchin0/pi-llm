import { describe, expect, it } from 'vitest';

import {
  isAssistantCompletionSlice,
  isAssistantMessageSlice,
} from '../../src/agent/piAssistantMessage.js';

describe('piAssistantMessage guards', () => {
  it('isAssistantMessageSlice rejects assistant messages without usage', () => {
    const message = { role: 'assistant', stopReason: 'stop' as const };

    expect(isAssistantMessageSlice(message)).toBe(false);
  });

  it('isAssistantCompletionSlice accepts assistant messages without usage', () => {
    const message = { role: 'assistant', stopReason: 'stop' as const };

    expect(isAssistantCompletionSlice(message)).toBe(true);
  });

  it('isAssistantMessageSlice accepts assistant messages with usage and stopReason', () => {
    const message = {
      role: 'assistant',
      stopReason: 'stop' as const,
      usage: { input: 1, output: 2, totalTokens: 3 },
    };

    expect(isAssistantMessageSlice(message)).toBe(true);
  });

  it('both guards reject non-assistant roles', () => {
    const message = { role: 'user', stopReason: 'stop' as const };

    expect(isAssistantMessageSlice(message)).toBe(false);
    expect(isAssistantCompletionSlice(message)).toBe(false);
  });
});
