import { describe, expect, it } from 'vitest';

import {
  buildEnrichedUserMessagePrefix,
  enrichUserMessage,
  getMessageText,
  stripEnrichedUserMessagePrefix,
} from '../../src/agent/piMessageText.js';

describe('piMessageText', () => {
  describe('enrichUserMessage prefix round-trip', () => {
    it('prepends a time prefix that strip removes', () => {
      const now = '2026-06-09T12:00:00.000-04:00';
      const enriched = enrichUserMessage('hello', () => now);

      expect(enriched).toBe(`${buildEnrichedUserMessagePrefix(now)}hello`);
      expect(stripEnrichedUserMessagePrefix(enriched)).toBe('hello');
    });

    it('leaves messages without a prefix unchanged', () => {
      expect(stripEnrichedUserMessagePrefix('plain message')).toBe('plain message');
    });
  });

  describe('getMessageText', () => {
    it('returns trimmed string content for assistant messages', () => {
      expect(getMessageText('assistant', '  hello  ')).toBe('hello');
    });

    it('strips the time prefix from user string content', () => {
      const content = enrichUserMessage('remember this', () => '2026-06-09T12:00:00.000Z');

      expect(getMessageText('user', content)).toBe('remember this');
    });

    it('joins text parts and strips the prefix for user role', () => {
      const content = [
        { type: 'text', text: enrichUserMessage('line one', () => '2026-06-09T12:00:00.000Z') },
        { type: 'text', text: 'line two' },
        { type: 'image', text: 'ignored' },
      ];

      expect(getMessageText('user', content)).toBe('line one\nline two');
    });

    it('returns empty string for unsupported content shapes', () => {
      expect(getMessageText('user', null)).toBe('');
      expect(getMessageText('assistant', { type: 'tool' })).toBe('');
    });
  });
});
