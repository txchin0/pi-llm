import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import type { IntegrationContext } from '../types.js';
import {
  buildDateRangeInTimezone,
  listEventsOnDate,
  listUpcomingEvents,
  parseDateTimeInput,
  queryFreeBusy,
  summarizeEvents,
  summarizeFreeBusy,
  toRfc3339,
} from './calendarClient.js';
import { formatOAuthConnectError, formatOAuthConnectMessage } from './oauthConnectMessage.js';

const calendarReadSchema = Type.Object({
  mode: Type.Optional(
    Type.Union(
      [
        Type.Literal('upcoming'),
        Type.Literal('on_date'),
        Type.Literal('range'),
        Type.Literal('free_busy'),
      ],
      { description: 'Query mode (default: upcoming)' },
    ),
  ),
  date: Type.Optional(
    Type.String({ description: 'Calendar date (YYYY-MM-DD) for on_date mode' }),
  ),
  timeMin: Type.Optional(
    Type.String({ description: 'Range start (ISO date or datetime) for range/free_busy modes' }),
  ),
  timeMax: Type.Optional(
    Type.String({ description: 'Range end (ISO date or datetime) for range/free_busy modes' }),
  ),
  maxResults: Type.Optional(
    Type.Number({
      description: 'Maximum events to return (default: 10)',
      minimum: 1,
      maximum: 50,
    }),
  ),
  calendarIds: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Calendar ids for free_busy mode (default: primary)',
    }),
  ),
});

type CalendarReadMode = 'upcoming' | 'on_date' | 'range' | 'free_busy';

/** Registers the `calendar_read` tool for surface agents. */
export function registerCalendarReadTool(pi: ExtensionAPI, ctx: IntegrationContext): void {
  pi.registerTool({
    name: 'calendar_read',
    label: 'calendar_read',
    description:
      'Read Google Calendar: upcoming events, events on a date, events in a time range, or free/busy status.',
    promptSnippet: 'Read the user Google Calendar schedule',
    promptGuidelines: [
      'Use calendar_read for schedule questions, availability checks, and upcoming events.',
      'Prefer on_date when the user names a specific day; use upcoming for "what is next".',
    ],
    parameters: calendarReadSchema,
    async execute(_toolCallId, params, signal) {
      try {
        if (signal?.aborted) {
          return cancelledResult();
        }

        const accessToken = await resolveAccessToken(ctx);
        const mode: CalendarReadMode = params.mode ?? 'upcoming';

        if (mode === 'free_busy') {
          const text = await runFreeBusyQuery(accessToken, params);
          return textResult(text);
        }

        if (mode === 'on_date') {
          if (params.date === undefined) {
            return textResult('on_date mode requires a date (YYYY-MM-DD).');
          }
          const events = await listEventsOnDate(
            accessToken,
            params.date,
            buildListOptions(params.maxResults),
          );
          return textResult(summarizeEvents(events));
        }

        if (mode === 'range') {
          if (params.timeMin === undefined || params.timeMax === undefined) {
            return textResult('range mode requires both timeMin and timeMax.');
          }
          const events = await listUpcomingEvents(accessToken, {
            ...buildListOptions(params.maxResults),
            timeMin: toRfc3339(parseDateTimeInput(params.timeMin)),
            timeMax: toRfc3339(parseDateTimeInput(params.timeMax)),
          });
          return textResult(summarizeEvents(events));
        }

        const events = await listUpcomingEvents(
          accessToken,
          buildListOptions(params.maxResults),
        );
        return textResult(summarizeEvents(events));
      } catch (error) {
        if (signal?.aborted) {
          return cancelledResult();
        }

        return textResult(formatCalendarReadError(error, ctx.userId));
      }
    },
  });
}

/** Resolves an OAuth access token or throws when the integration is not connected. */
async function resolveAccessToken(ctx: IntegrationContext): Promise<string> {
  if (ctx.getAccessToken === undefined) {
    throw new NotConnectedError(ctx.userId);
  }
  return ctx.getAccessToken();
}

class NotConnectedError extends Error {
  readonly userId: string;

  /** Marks a missing OAuth binding as a not-connected state for friendly tool output. */
  constructor(userId: string) {
    super('OAuth not connected');
    this.name = 'NotConnectedError';
    this.userId = userId;
  }
}

/** Runs a free/busy query using explicit or date-derived bounds. */
async function runFreeBusyQuery(
  accessToken: string,
  params: {
    date?: string;
    timeMin?: string;
    timeMax?: string;
    calendarIds?: string[];
  },
): Promise<string> {
  let timeMin = params.timeMin;
  let timeMax = params.timeMax;

  if (params.date !== undefined) {
    const range = buildDateRangeInTimezone(params.date);
    timeMin = range.timeMin;
    timeMax = range.timeMax;
  }

  if (timeMin === undefined || timeMax === undefined) {
    return 'free_busy mode requires a date or both timeMin and timeMax.';
  }

  const intervals = await queryFreeBusy(accessToken, {
    timeMin: toRfc3339(parseDateTimeInput(timeMin)),
    timeMax: toRfc3339(parseDateTimeInput(timeMax)),
    ...(params.calendarIds !== undefined ? { calendarIds: params.calendarIds } : {}),
  });

  return summarizeFreeBusy(intervals);
}

function buildListOptions(maxResults?: number) {
  if (maxResults === undefined) {
    return {};
  }
  return { maxResults };
}

function formatCalendarReadError(error: unknown, userId: string): string {
  if (error instanceof NotConnectedError) {
    return formatOAuthConnectMessage(userId);
  }

  const oauthMessage = formatOAuthConnectError(error, userId);
  if (oauthMessage !== null) {
    return oauthMessage;
  }

  if (error instanceof Error) {
    return `Calendar read failed: ${error.message}`;
  }

  return 'Calendar read failed';
}

function textResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    details: {},
  };
}

function cancelledResult() {
  return textResult('Request was cancelled');
}
