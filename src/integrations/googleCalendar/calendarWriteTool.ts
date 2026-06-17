import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import type { IntegrationContext } from '../types.js';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  findExistingEventBySummaryAndStart,
  summarizeEvents,
  updateCalendarEvent,
} from './calendarClient.js';
import { formatOAuthConnectError, formatOAuthConnectMessage } from './oauthConnectMessage.js';

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
  skipDuplicateCheck: Type.Optional(
    Type.Boolean({
      description:
        'When true, always create even if a matching summary+start event exists (default: false)',
    }),
  ),
});

type CalendarWriteAction = 'create' | 'update' | 'delete';

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
    ],
    parameters: calendarWriteSchema,
    async execute(_toolCallId, params, signal) {
      try {
        if (signal?.aborted) {
          return cancelledResult();
        }

        const accessToken = await resolveAccessToken(ctx);
        const text = await runCalendarWriteAction(accessToken, params);
        return textResult(text);
      } catch (error) {
        if (signal?.aborted) {
          return cancelledResult();
        }

        return textResult(formatCalendarWriteError(error, ctx.userId));
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

/** Dispatches a calendar write action and returns a plain-text summary. */
async function runCalendarWriteAction(
  accessToken: string,
  params: {
    action: CalendarWriteAction;
    eventId?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: string;
    end?: string;
    skipDuplicateCheck?: boolean;
  },
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
  params: {
    summary?: string;
    description?: string;
    location?: string;
    start?: string;
    end?: string;
    skipDuplicateCheck?: boolean;
  },
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
    ...(params.description !== undefined ? { description: params.description } : {}),
    ...(params.location !== undefined ? { location: params.location } : {}),
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
  params: {
    eventId?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: string;
    end?: string;
  },
): Promise<string> {
  if (params.eventId === undefined) {
    return 'update requires eventId.';
  }

  const updated = await updateCalendarEvent(accessToken, {
    eventId: params.eventId,
    ...(params.summary !== undefined ? { summary: params.summary } : {}),
    ...(params.description !== undefined ? { description: params.description } : {}),
    ...(params.location !== undefined ? { location: params.location } : {}),
    ...(params.start !== undefined ? { start: params.start } : {}),
    ...(params.end !== undefined ? { end: params.end } : {}),
  });

  return ['Calendar event updated:', summarizeEvents([updated])].join('\n');
}

/** Deletes an event by id. */
async function deleteEvent(
  accessToken: string,
  params: { eventId?: string },
): Promise<string> {
  if (params.eventId === undefined) {
    return 'delete requires eventId.';
  }

  await deleteCalendarEvent(accessToken, params.eventId);
  return `Calendar event ${params.eventId} deleted.`;
}

function formatCalendarWriteError(error: unknown, userId: string): string {
  if (error instanceof NotConnectedError) {
    return formatOAuthConnectMessage(userId);
  }

  const oauthMessage = formatOAuthConnectError(error, userId);
  if (oauthMessage !== null) {
    return oauthMessage;
  }

  if (error instanceof Error) {
    return `Calendar write failed: ${error.message}`;
  }

  return 'Calendar write failed';
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
