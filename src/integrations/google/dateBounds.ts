import { DateTime } from 'luxon';

import { env } from '../../config/env.js';

/** Calendar date as YYYY-MM-DD (Tasks API due field is date-only). */
export type DateOnly = string;

/** Builds RFC3339 bounds for all events on a calendar date in the app timezone. */
export function buildDateRangeInTimezone(
  date: string,
  timezone: string = env.TIMEZONE,
): { timeMin: string; timeMax: string } {
  const dayStart = DateTime.fromISO(date, { zone: timezone }).startOf('day');
  if (!dayStart.isValid) {
    throw new Error(`Invalid date "${date}" for timezone "${timezone}"`);
  }

  const dayEnd = dayStart.endOf('day');
  return {
    timeMin: toRfc3339(dayStart),
    timeMax: toRfc3339(dayEnd),
  };
}

/** Parses a date or datetime string in the app timezone for API calls. */
export function parseDateTimeInput(
  value: string,
  timezone: string = env.TIMEZONE,
): DateTime {
  const fromIso = DateTime.fromISO(value, { zone: timezone });
  if (fromIso.isValid) {
    return fromIso;
  }

  const fromDate = DateTime.fromISO(value, { zone: timezone }).startOf('day');
  if (fromDate.isValid) {
    return fromDate;
  }

  throw new Error(`Invalid date or datetime "${value}"`);
}

/** Converts a Luxon DateTime to RFC3339 for Google API calls. */
export function toRfc3339(value: DateTime): string {
  return value.toUTC().toISO({ suppressMilliseconds: true }) ?? value.toUTC().toISO()!;
}

/** Validates and parses a YYYY-MM-DD date string. */
export function parseDateOnly(value: string, timezone: string = env.TIMEZONE): DateOnly {
  const parsed = DateTime.fromISO(value, { zone: timezone }).startOf('day');
  if (!parsed.isValid) {
    throw new Error(`Invalid date "${value}" (expected YYYY-MM-DD)`);
  }
  return parsed.toISODate() ?? value;
}

/** Maps a calendar date to RFC3339 dueMin/dueMax bounds for the Tasks API. */
export function toTasksApiDueBound(
  date: DateOnly,
  bound: 'start' | 'end',
  timezone: string = env.TIMEZONE,
): string {
  const range = buildDateRangeInTimezone(date, timezone);
  return bound === 'start' ? range.timeMin : range.timeMax;
}
