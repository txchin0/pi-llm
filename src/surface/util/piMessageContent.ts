import { stripEnrichedUserMessagePrefix } from './enrichUserMessage.js';

type MessageRole = 'user' | 'assistant';

export type TextPart = {
  type: string;
  text?: string;
};

/** Returns true when content is a Pi text-part array. */
export function isTextPartArray(content: unknown): content is TextPart[] {
  return Array.isArray(content);
}

/** Extracts plain text from a Pi user or assistant message payload. */
export function getMessageText(
  role: MessageRole,
  content: unknown,
): string {
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
