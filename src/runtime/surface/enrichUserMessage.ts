import { DateTime } from 'luxon';

/** Prepends current time context to the inbound user message. */
export function enrichUserMessage(
  message: string,
  now: () => string = () => DateTime.utc().toISO() ?? new Date().toISOString(),
): string {
  return `[Current time: ${now()}]\n\n${message}`;
}
