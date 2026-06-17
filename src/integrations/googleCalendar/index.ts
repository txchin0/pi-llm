import type { IntegrationDefinition, IntegrationToolSpec } from '../types.js';
import { registerCalendarReadTool } from './calendarReadTool.js';
import { registerCalendarWriteTool } from './calendarWriteTool.js';

const GOOGLE_CALENDAR_READONLY_SCOPE =
  'https://www.googleapis.com/auth/calendar.readonly';
const GOOGLE_CALENDAR_EVENTS_SCOPE =
  'https://www.googleapis.com/auth/calendar.events';

const calendarReadToolSpec: IntegrationToolSpec = {
  name: 'calendar_read',
  register(pi, ctx) {
    registerCalendarReadTool(pi, ctx);
  },
};

const calendarWriteToolSpec: IntegrationToolSpec = {
  name: 'calendar_write',
  register(pi, ctx) {
    registerCalendarWriteTool(pi, ctx);
  },
};

/** Google Calendar integration with OAuth-gated read (surface) and write (worker) tools. */
export const googleCalendarIntegration: IntegrationDefinition = {
  id: 'google_calendar',
  label: 'Google Calendar',
  defaultEnabled: false,
  oauth: {
    providerId: 'google',
    scopes: {
      surface: [GOOGLE_CALENDAR_READONLY_SCOPE],
      worker: [GOOGLE_CALENDAR_EVENTS_SCOPE],
    },
  },
  tools: {
    surface: [calendarReadToolSpec],
    worker: [calendarWriteToolSpec],
  },
  systemPrompt: {
    surface:
      'When the user asks about their schedule or availability, use calendar_read. If Google is not connected, share the connect URL from the tool result.',
    worker:
      'Use calendar_write to create, update, or delete calendar events. Reuse event ids from prior tool results on retries to stay idempotent.',
  },
};
