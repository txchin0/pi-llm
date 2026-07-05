import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import type { IntegrationContext } from '../types.js';
import {
  cancelledToolResult,
  formatGoogleToolError,
  resolveGoogleAccessToken,
  textToolResult,
} from '../google/toolRuntime.js';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  findExistingEventBySummaryAndStart,
  summarizeEvents,
  updateCalendarEvent,
  type CreateEventInput,
} from './calendarClient.js';

const calendarWriteSchema = Type.Object({
  action: Type.Union(
    [Type.Literal('create'), Type.Literal('update'), Type.Literal('delete')],
    { description: 'Whether to create, update, or delete an event' },
  ),
  eventId: Type.Optional(
    Type.String({ description: 'Existing event id (required for update/delete)' }),
  ),
  summary: Type.Optional(Type.String({ description: 'Event title' })),
  description: Type.Optional(Type.String({ description: 'Event description' })),
  location: Type.Optional(Type.String({ description: 'Event location' })),
  start: Type.Optional(
    Type.String({ description: 'Start time (ISO date or datetime) for create/update' }),
  ),
  end: Type.Optional(
    Type.String({ description: 'End time (ISO date or datetime) for create/update' }),
  ),
  reminderMinutes: Type.Optional(
    Type.Array(Type.Number(), {
      description:
        'Popup reminder offsets in minutes before event start (e.g. [30, 10]). Omit for calendar defaults; pass [] to clear.',
    }),
  ),
  skipDuplicateCheck: Type.Optional(
    Type.Boolean({
      description:
        'When true, always create even if a matching summary+start event exists (default: false)',
    }),
  ),
});

type CalendarWriteAction = 'create' | 'update' | 'delete';

type CalendarWriteParams = {
  action: CalendarWriteAction;
  eventId?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  reminderMinutes?: number[];
  skipDuplicateCheck?: boolean;
};

/** Registers the `calendar_write` tool for worker agents. */
export function registerCalendarWriteTool(pi: ExtensionAPI, ctx: IntegrationContext): void {
  pi.registerTool({
    name: 'calendar_write',
    label: 'calendar_write',
    description:
      'Create, update, or delete Google Calendar events. Retries should reuse eventId from prior results.',
    promptSnippet: 'Create or modify Google Calendar events',
    promptGuidelines: [
      'Use calendar_write to schedule, reschedule, or cancel calendar events.',
      'On create, the tool checks for an existing event with the same title and start before inserting.',
      'Store and reuse the returned event id on retries so update/delete remain idempotent.',
      'When the user asks for a reminder before an event, set reminderMinutes (e.g. [30] for 30 minutes before).',
    ],
    parameters: calendarWriteSchema,
    async execute(_toolCallId, params, signal) {
      try {
        if (signal?.aborted) {
          return cancelledToolResult();
        }

        const accessToken = await resolveGoogleAccessToken(ctx);
        const text = await runCalendarWriteAction(accessToken, params);
        return textToolResult(text);
      } catch (error) {
        if (signal?.aborted) {
          return cancelledToolResult();
        }

        return textToolResult(formatGoogleToolError('Calendar', error));
      }
    },
  });
}

/** Collects optional event fields provided on a write tool call. */
function pickOptionalEventFields(
  params: Pick<CalendarWriteParams, 'description' | 'location' | 'reminderMinutes'>,
): Pick<CreateEventInput, 'description' | 'location' | 'reminderMinutes'> {
  const fields: Pick<CreateEventInput, 'description' | 'location' | 'reminderMinutes'> = {};

  if (params.description !== undefined) {
    fields.description = params.description;
  }
  if (params.location !== undefined) {
    fields.location = params.location;
  }
  if (params.reminderMinutes !== undefined) {
    fields.reminderMinutes = params.reminderMinutes;
  }

  return fields;
}

/** Dispatches a calendar write action and returns a plain-text summary. */
async function runCalendarWriteAction(
  accessToken: string,
  params: CalendarWriteParams,
): Promise<string> {
  switch (params.action) {
    case 'create':
      return createEvent(accessToken, params);
    case 'update':
      return updateEvent(accessToken, params);
    case 'delete':
      return deleteEvent(accessToken, params);
    default: {
      const _exhaustive: never = params.action;
      return _exhaustive;
    }
  }
}

/** Creates an event, reusing an existing match when found for idempotent retries. */
async function createEvent(
  accessToken: string,
  params: CalendarWriteParams,
): Promise<string> {
  if (params.summary === undefined || params.start === undefined || params.end === undefined) {
    return 'create requires summary, start, and end.';
  }

  if (params.skipDuplicateCheck !== true) {
    const existing = await findExistingEventBySummaryAndStart(accessToken, {
      summary: params.summary,
      start: params.start,
    });
    if (existing !== undefined) {
      return [
        'Existing calendar event found (idempotent create):',
        summarizeEvents([existing]),
        '',
        `Reuse event id ${existing.id} on retries.`,
      ].join('\n');
    }
  }

  const created = await createCalendarEvent(accessToken, {
    summary: params.summary,
    start: params.start,
    end: params.end,
    ...pickOptionalEventFields(params),
  });

  return [
    'Calendar event created:',
    summarizeEvents([created]),
    '',
    `Reuse event id ${created.id} on retries.`,
  ].join('\n');
}

/** Updates an event by id. */
async function updateEvent(
  accessToken: string,
  params: CalendarWriteParams,
): Promise<string> {
  if (params.eventId === undefined) {
    return 'update requires eventId.';
  }

  const updated = await updateCalendarEvent(accessToken, {
    eventId: params.eventId,
    ...pickOptionalEventFields(params),
    ...(params.summary !== undefined ? { summary: params.summary } : {}),
    ...(params.start !== undefined ? { start: params.start } : {}),
    ...(params.end !== undefined ? { end: params.end } : {}),
  });

  return ['Calendar event updated:', summarizeEvents([updated])].join('\n');
}

/** Deletes an event by id. */
async function deleteEvent(
  accessToken: string,
  params: Pick<CalendarWriteParams, 'eventId'>,
): Promise<string> {
  if (params.eventId === undefined) {
    return 'delete requires eventId.';
  }

  await deleteCalendarEvent(accessToken, params.eventId);
  return `Calendar event ${params.eventId} deleted.`;
}
