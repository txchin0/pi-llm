import { DateTime } from 'luxon';

import { env } from '../../config/env.js';
import type { calendar_v3 } from 'googleapis';

const DEFAULT_CALENDAR_ID = 'primary';
const DEFAULT_MAX_RESULTS = 10;

/** Normalized calendar event returned to integration tools. */
export type CalendarEventSummary = {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  status?: string;
};

/** Options for listing events within a time window. */
export type ListEventsOptions = {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  query?: string;
};

/** Fields required to create a calendar event. */
export type CreateEventInput = {
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
};

/** Fields for updating an existing calendar event. */
export type UpdateEventInput = {
  calendarId?: string;
  eventId: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
};

/** One busy interval within a free/busy response. */
export type FreeBusyInterval = {
  calendarId: string;
  start: string;
  end: string;
};

/** Injectable calendar API surface for tests. */
export type CalendarApi = Pick<
  calendar_v3.Calendar,
  'events' | 'freebusy'
>;

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

/** Converts a Luxon DateTime to RFC3339 for the Google Calendar API. */
export function toRfc3339(value: DateTime): string {
  return value.toUTC().toISO({ suppressMilliseconds: true }) ?? value.toUTC().toISO()!;
}

/** Formats one Google event into a display-friendly summary. */
export function formatCalendarEvent(
  event: calendar_v3.Schema$Event,
  timezone: string = env.TIMEZONE,
): CalendarEventSummary {
  const id = event.id ?? '';
  const summary = event.summary?.trim() || '(no title)';
  const start = formatEventDateTime(event.start, timezone);
  const end = formatEventDateTime(event.end, timezone);

  const formatted: CalendarEventSummary = {
    id,
    summary,
    start,
    end,
  };

  if (event.description !== undefined && event.description !== null) {
    formatted.description = event.description;
  }
  if (event.location !== undefined && event.location !== null) {
    formatted.location = event.location;
  }
  if (event.status !== undefined && event.status !== null) {
    formatted.status = event.status;
  }

  return formatted;
}

/** Renders a list of events as plain text for tool output. */
export function summarizeEvents(events: CalendarEventSummary[]): string {
  if (events.length === 0) {
    return 'No calendar events found.';
  }

  const lines = events.map((event, index) => {
    const parts = [
      `${index + 1}. ${event.summary}`,
      `   When: ${event.start} – ${event.end}`,
      `   ID: ${event.id}`,
    ];
    if (event.location) {
      parts.push(`   Location: ${event.location}`);
    }
    if (event.description) {
      parts.push(`   Description: ${event.description}`);
    }
    return parts.join('\n');
  });

  return lines.join('\n\n');
}

/** Renders free/busy intervals as plain text for tool output. */
export function summarizeFreeBusy(intervals: FreeBusyInterval[]): string {
  if (intervals.length === 0) {
    return 'No busy intervals found in the requested window.';
  }

  const lines = intervals.map((interval, index) => {
    return `${index + 1}. ${interval.calendarId}: ${interval.start} – ${interval.end}`;
  });

  return `Busy intervals:\n${lines.join('\n')}`;
}

/** Creates a googleapis Calendar client authenticated with a bearer access token. */
export async function createCalendarApi(accessToken: string): Promise<CalendarApi> {
  const { google } = await import('googleapis');
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: 'v3', auth });
}

/** Lists upcoming events from now in the app timezone. */
export async function listUpcomingEvents(
  accessToken: string,
  options: ListEventsOptions = {},
  calendarApi?: CalendarApi,
): Promise<CalendarEventSummary[]> {
  const now = DateTime.now().setZone(env.TIMEZONE);
  return listEventsInRange(
    accessToken,
    {
      ...options,
      timeMin: options.timeMin ?? toRfc3339(now),
    },
    calendarApi,
  );
}

/** Lists events within an optional time range. */
export async function listEventsInRange(
  accessToken: string,
  options: ListEventsOptions = {},
  calendarApi?: CalendarApi,
): Promise<CalendarEventSummary[]> {
  const api = calendarApi ?? (await createCalendarApi(accessToken));
  const calendarId = options.calendarId ?? DEFAULT_CALENDAR_ID;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;

  const listParams: calendar_v3.Params$Resource$Events$List = {
    calendarId,
    maxResults,
    singleEvents: true,
    orderBy: 'startTime',
  };
  if (options.timeMin !== undefined) {
    listParams.timeMin = options.timeMin;
  }
  if (options.timeMax !== undefined) {
    listParams.timeMax = options.timeMax;
  }
  if (options.query !== undefined) {
    listParams.q = options.query;
  }

  const response = await api.events.list(listParams);

  const items = response.data.items ?? [];
  return items.map((event) => formatCalendarEvent(event));
}

/** Lists events occurring on a single calendar date. */
export async function listEventsOnDate(
  accessToken: string,
  date: string,
  options: Omit<ListEventsOptions, 'timeMin' | 'timeMax'> = {},
  calendarApi?: CalendarApi,
): Promise<CalendarEventSummary[]> {
  const range = buildDateRangeInTimezone(date);
  return listEventsInRange(
    accessToken,
    {
      ...options,
      timeMin: range.timeMin,
      timeMax: range.timeMax,
    },
    calendarApi,
  );
}

/** Queries free/busy information for one or more calendars. */
export async function queryFreeBusy(
  accessToken: string,
  input: {
    timeMin: string;
    timeMax: string;
    calendarIds?: string[];
  },
  calendarApi?: CalendarApi,
): Promise<FreeBusyInterval[]> {
  const api = calendarApi ?? (await createCalendarApi(accessToken));
  const calendarIds = input.calendarIds ?? [DEFAULT_CALENDAR_ID];

  const response = await api.freebusy.query({
    requestBody: {
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      items: calendarIds.map((id) => ({ id })),
    },
  });

  const calendars = response.data.calendars ?? {};
  const intervals: FreeBusyInterval[] = [];

  for (const calendarId of calendarIds) {
    const busy = calendars[calendarId]?.busy ?? [];
    for (const slot of busy) {
      if (slot.start === undefined || slot.start === null || slot.end === undefined || slot.end === null) {
        continue;
      }
      intervals.push({
        calendarId,
        start: formatApiDateTime(slot.start),
        end: formatApiDateTime(slot.end),
      });
    }
  }

  return intervals;
}

/** Creates a calendar event and returns the created event summary. */
export async function createCalendarEvent(
  accessToken: string,
  input: CreateEventInput,
  calendarApi?: CalendarApi,
): Promise<CalendarEventSummary> {
  const api = calendarApi ?? (await createCalendarApi(accessToken));
  const calendarId = input.calendarId ?? DEFAULT_CALENDAR_ID;

  const response = await api.events.insert({
    calendarId,
    requestBody: buildEventBody(input),
  });

  return formatCalendarEvent(response.data);
}

/** Updates an existing calendar event by id. */
export async function updateCalendarEvent(
  accessToken: string,
  input: UpdateEventInput,
  calendarApi?: CalendarApi,
): Promise<CalendarEventSummary> {
  const api = calendarApi ?? (await createCalendarApi(accessToken));
  const calendarId = input.calendarId ?? DEFAULT_CALENDAR_ID;

  const response = await api.events.patch({
    calendarId,
    eventId: input.eventId,
    requestBody: buildEventPatchBody(input),
  });

  return formatCalendarEvent(response.data);
}

/** Deletes a calendar event by id. */
export async function deleteCalendarEvent(
  accessToken: string,
  eventId: string,
  calendarId: string = DEFAULT_CALENDAR_ID,
  calendarApi?: CalendarApi,
): Promise<void> {
  const api = calendarApi ?? (await createCalendarApi(accessToken));
  await api.events.delete({ calendarId, eventId });
}

/**
 * Finds an existing event with the same summary and start time for idempotent creates.
 * Returns the first exact match within a one-minute window.
 */
export async function findExistingEventBySummaryAndStart(
  accessToken: string,
  input: { summary: string; start: string; calendarId?: string },
  calendarApi?: CalendarApi,
): Promise<CalendarEventSummary | undefined> {
  const start = parseDateTimeInput(input.start);
  const window = {
    timeMin: toRfc3339(start.minus({ minutes: 1 })),
    timeMax: toRfc3339(start.plus({ minutes: 1 })),
  };

  const listOptions: ListEventsOptions = {
    timeMin: window.timeMin,
    timeMax: window.timeMax,
    query: input.summary,
    maxResults: 20,
  };
  if (input.calendarId !== undefined) {
    listOptions.calendarId = input.calendarId;
  }

  const events = await listEventsInRange(accessToken, listOptions, calendarApi);

  const normalizedStart = formatApiDateTime(toRfc3339(start));
  return events.find(
    (event) => event.summary === input.summary && event.start === normalizedStart,
  );
}

function buildEventBody(input: CreateEventInput): calendar_v3.Schema$Event {
  const body: calendar_v3.Schema$Event = {
    summary: input.summary,
    start: toEventDateTime(input.start),
    end: toEventDateTime(input.end),
  };

  if (input.description !== undefined) {
    body.description = input.description;
  }
  if (input.location !== undefined) {
    body.location = input.location;
  }

  return body;
}

function buildEventPatchBody(input: UpdateEventInput): calendar_v3.Schema$Event {
  const body: calendar_v3.Schema$Event = {};

  if (input.summary !== undefined) {
    body.summary = input.summary;
  }
  if (input.description !== undefined) {
    body.description = input.description;
  }
  if (input.location !== undefined) {
    body.location = input.location;
  }
  if (input.start !== undefined) {
    body.start = toEventDateTime(input.start);
  }
  if (input.end !== undefined) {
    body.end = toEventDateTime(input.end);
  }

  return body;
}

function toEventDateTime(value: string): calendar_v3.Schema$EventDateTime {
  const parsed = parseDateTimeInput(value);
  if (parsed.hour === 0 && parsed.minute === 0 && parsed.second === 0 && !value.includes('T')) {
    return { date: parsed.toISODate() ?? value };
  }

  return {
    dateTime: toRfc3339(parsed),
    timeZone: env.TIMEZONE,
  };
}

function formatEventDateTime(
  value: calendar_v3.Schema$EventDateTime | undefined | null,
  timezone: string,
): string {
  if (value === undefined || value === null) {
    return 'unknown';
  }

  if (value.date !== undefined && value.date !== null) {
    const allDay = DateTime.fromISO(value.date, { zone: timezone }).startOf('day');
    return allDay.isValid ? `${allDay.toFormat('yyyy-LL-dd')} (all day)` : value.date;
  }

  if (value.dateTime !== undefined && value.dateTime !== null) {
    return formatApiDateTime(value.dateTime, timezone);
  }

  return 'unknown';
}

function formatApiDateTime(value: string, timezone: string = env.TIMEZONE): string {
  const parsed = DateTime.fromISO(value, { zone: 'utc' }).setZone(timezone);
  if (!parsed.isValid) {
    return value;
  }
  return parsed.toFormat('yyyy-LL-dd HH:mm z');
}
