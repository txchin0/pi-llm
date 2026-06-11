import type { SessionEntry } from '@earendil-works/pi-coding-agent';

import { stripEnrichedUserMessagePrefix } from '../surface/util/enrichUserMessage.js';
import type { ConversationTurn, TaskContext } from './taskTypes.js';

type MessageRole = ConversationTurn['role'];

/** Minimal session history surface used to build task context. */
export type SessionHistoryReader = {
  getBranch(): readonly SessionEntry[];
};

type TextPart = {
  type: string;
  text?: string;
};

/** Extracts plain text from a Pi user or assistant message payload. */
function extractMessageText(role: MessageRole, content: string | TextPart[]): string {
  if (typeof content === 'string') {
    const text = role === 'user' ? stripEnrichedUserMessagePrefix(content) : content;
    return text.trim();
  }

  const text = content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();

  return role === 'user' ? stripEnrichedUserMessagePrefix(text) : text;
}

/** Collects user/assistant turn pairs from chronological session message entries. */
function collectTurnsFromEntries(entries: readonly SessionEntry[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let pendingUser: ConversationTurn | undefined;

  for (const entry of entries) {
    if (entry.type !== 'message') {
      continue;
    }

    const message = entry.message;
    if (message.role !== 'user' && message.role !== 'assistant') {
      continue;
    }

    const text = extractMessageText(message.role, message.content as string | TextPart[]);
    if (text === '') {
      continue;
    }

    if (message.role === 'user') {
      if (pendingUser !== undefined) {
        turns.push(pendingUser);
      }
      pendingUser = { role: 'user', content: text };
      continue;
    }

    if (pendingUser !== undefined) {
      turns.push(pendingUser, { role: 'assistant', content: text });
      pendingUser = undefined;
    }
  }

  if (pendingUser !== undefined) {
    turns.push(pendingUser);
  }

  return turns;
}

/** Groups flat user/assistant messages into turn pairs for context storage. */
function groupTurnPairs(flatTurns: readonly ConversationTurn[]): ConversationTurn[][] {
  const pairs: ConversationTurn[][] = [];
  let index = 0;

  while (index < flatTurns.length) {
    const current = flatTurns[index];
    if (current?.role !== 'user') {
      index += 1;
      continue;
    }

    const next = flatTurns[index + 1];
    if (next?.role === 'assistant') {
      pairs.push([current, next]);
      index += 2;
      continue;
    }

    pairs.push([current]);
    index += 1;
  }

  return pairs;
}

/** Builds task context from the last N conversation turns in the Pi session. */
export function extractRecentTurns(
  sessionManager: SessionHistoryReader,
  turnLimit: number,
): TaskContext {
  if (turnLimit <= 0) {
    return { turns: [] };
  }

  const entries = sessionManager.getBranch();
  const flatTurns = collectTurnsFromEntries(entries);
  const pairs = groupTurnPairs(flatTurns);
  const recentPairs = pairs.slice(-turnLimit);

  return {
    turns: recentPairs.flat(),
  };
}
