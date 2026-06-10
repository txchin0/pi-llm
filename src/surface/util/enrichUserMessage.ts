import { DateTime } from 'luxon';

import { env } from '../../config/env.js';

/** Returns the current time as an ISO string in the configured timezone. */
export function formatNowInTimezone(timezone: string = env.TIMEZONE): string {
  return DateTime.now().setZone(timezone).toISO() ?? new Date().toISOString();
}

/** Prepends current time context to the inbound user message. */
export function enrichUserMessage(
  message: string,
  now: () => string = () => formatNowInTimezone(),
): string {
  return `[Current time: ${now()}]\n\n${message}`;
}
