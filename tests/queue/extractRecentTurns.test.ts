import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';

import {
  extractRecentTurns,
  type SessionHistoryReader,
} from '../../src/queue/extractRecentTurns.js';

function messageEntry(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  parentId: string | null = null,
): SessionEntry {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: {
      role,
      content,
      timestamp: Date.now(),
      ...(role === 'assistant'
        ? {
            api: 'openai-completions',
            provider: 'openai',
            model: 'test-model',
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: 'stop' as const,
          }
        : {}),
    },
  } as SessionEntry;
}

function createSessionManager(entries: SessionEntry[]): SessionHistoryReader {
  return {
    getBranch: () => entries,
  };
}

describe('extractRecentTurns', () => {
  it('returns an empty context when turn limit is zero', () => {
    const sessionManager = createSessionManager([
      messageEntry('1', 'user', 'hello'),
    ]);

    expect(extractRecentTurns(sessionManager, 0)).toEqual({ turns: [] });
  });

  it('strips the volatile time prefix from user messages', () => {
    const sessionManager = createSessionManager([
      messageEntry('1', 'user', '[Current time: 2026-06-10T12:00:00.000+10:00]\n\nSet a reminder'),
      messageEntry('2', 'assistant', 'I will schedule that.', '1'),
    ]);

    expect(extractRecentTurns(sessionManager, 3)).toEqual({
      turns: [
        { role: 'user', content: 'Set a reminder' },
        { role: 'assistant', content: 'I will schedule that.' },
      ],
    });
  });

  it('returns only the last N turn pairs', () => {
    const sessionManager = createSessionManager([
      messageEntry('1', 'user', 'first question'),
      messageEntry('2', 'assistant', 'first answer', '1'),
      messageEntry('3', 'user', 'second question', '2'),
      messageEntry('4', 'assistant', 'second answer', '3'),
      messageEntry('5', 'user', 'third question', '4'),
      messageEntry('6', 'assistant', 'third answer', '5'),
    ]);

    expect(extractRecentTurns(sessionManager, 2)).toEqual({
      turns: [
        { role: 'user', content: 'second question' },
        { role: 'assistant', content: 'second answer' },
        { role: 'user', content: 'third question' },
        { role: 'assistant', content: 'third answer' },
      ],
    });
  });

  it('includes a trailing user-only turn when no assistant reply exists yet', () => {
    const sessionManager = createSessionManager([
      messageEntry('1', 'user', 'first question'),
      messageEntry('2', 'assistant', 'first answer', '1'),
      messageEntry('3', 'user', 'follow-up question', '2'),
    ]);

    expect(extractRecentTurns(sessionManager, 3)).toEqual({
      turns: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'follow-up question' },
      ],
    });
  });
});
