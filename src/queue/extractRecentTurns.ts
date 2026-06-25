import type { SessionEntry } from '@earendil-works/pi-coding-agent';

import { getMessageText } from '../agent/piMessageText.js';
import type { ConversationTurn, TaskContext } from './taskTypes.js';

/** Minimal session history surface used to build task context. */
export type SessionHistoryReader = {
  getBranch(): readonly SessionEntry[];
};

/** Builds task context from the last N conversation turn pairs in the Pi session. */
export function extractRecentTurns(
  sessionManager: SessionHistoryReader,
  turnLimit: number,
): TaskContext {
  if (turnLimit <= 0) {
    return { turns: [] };
  }

  const pairs: ConversationTurn[][] = [];
  let pendingUser: ConversationTurn | undefined;

  for (const entry of sessionManager.getBranch()) {
    if (entry.type !== 'message') {
      continue;
    }

    const message = entry.message;
    if (message.role !== 'user' && message.role !== 'assistant') {
      continue;
    }

    const text = getMessageText(message.role, message.content);
    if (text === '') {
      continue;
    }

    if (message.role === 'user') {
      if (pendingUser !== undefined) {
        pairs.push([pendingUser]);
      }
      pendingUser = { role: 'user', content: text };
      continue;
    }

    if (pendingUser !== undefined) {
      pairs.push([pendingUser, { role: 'assistant', content: text }]);
      pendingUser = undefined;
    }
  }

  if (pendingUser !== undefined) {
    pairs.push([pendingUser]);
  }

  return {
    turns: pairs.slice(-turnLimit).flat(),
  };
}
