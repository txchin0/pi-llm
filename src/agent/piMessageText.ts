import { DateTime } from 'luxon';

import { env } from '../config/env.js';

const TIME_PREFIX_PATTERN = /^\[Current time: [^\]]+\]\n\n/;

type MessageRole = 'user' | 'assistant';

export type TextPart = {
  type: string;
  text?: string;
};

/** Returns the current time as an ISO string in the configured timezone. */
export function formatNowInTimezone(timezone: string = env.TIMEZONE): string {
  return DateTime.now().setZone(timezone).toISO() ?? new Date().toISOString();
}

/** Builds the volatile time prefix prepended to inbound user messages. */
export function buildEnrichedUserMessagePrefix(now: string): string {
  return `[Current time: ${now}]\n\n`;
}

/** Removes the volatile time prefix prepended to inbound user messages. */
export function stripEnrichedUserMessagePrefix(message: string): string {
  return message.replace(TIME_PREFIX_PATTERN, '');
}

/** Prepends current time context to the inbound user message. */
export function enrichUserMessage(
  message: string,
  now: () => string = () => formatNowInTimezone(),
): string {
  return `${buildEnrichedUserMessagePrefix(now())}${message}`;
}

/** Returns true when content is a Pi text-part array. */
export function isTextPartArray(content: unknown): content is TextPart[] {
  return Array.isArray(content);
}

/** Extracts plain text from a Pi user or assistant message payload. */
export function getMessageText(role: MessageRole, content: unknown): string {
  if (typeof content === 'string') {
    const text = role === 'user' ? stripEnrichedUserMessagePrefix(content) : content;
    return text.trim();
  }

  if (!isTextPartArray(content)) {
    return '';
  }

  const text = content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();

  return role === 'user' ? stripEnrichedUserMessagePrefix(text) : text;
}
