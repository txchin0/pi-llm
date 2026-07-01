import { describe, expect, it, vi } from 'vitest';

import {
  buildDateRangeInTimezone,
  createCalendarEvent,
  formatCalendarEvent,
  listEventsOnDate,
  parseDateTimeInput,
  summarizeEvents,
  summarizeFreeBusy,
  toRfc3339,
  updateCalendarEvent,
  type CalendarApi,
} from '../../../src/integrations/googleCalendar/calendarClient.js';

describe('buildDateRangeInTimezone', () => {
  it('returns start and end of day in RFC3339 for a calendar date', () => {
    const range = buildDateRangeInTimezone('2026-06-16', 'Australia/Sydney');

    expect(range.timeMin).toMatch(/^2026-06-1[56]T/);
    expect(range.timeMax).toMatch(/^2026-06-1[67]T/);
    expect(range.timeMin < range.timeMax).toBe(true);
  });
});

describe('parseDateTimeInput', () => {
  it('parses ISO datetimes in the configured timezone', () => {
    const value = parseDateTimeInput('2026-06-16T09:30:00', 'Australia/Sydney');
    expect(value.toFormat('yyyy-LL-dd HH:mm')).toBe('2026-06-16 09:30');
  });
});

describe('toRfc3339', () => {
  it('emits UTC ISO strings suitable for Google Calendar API calls', () => {
    const value = toRfc3339(parseDateTimeInput('2026-06-16T09:30:00', 'Australia/Sydney'));
    expect(value.endsWith('Z')).toBe(true);
  });
});

describe('formatCalendarEvent', () => {
  it('formats all-day and timed events for display', () => {
    const allDay = formatCalendarEvent(
      { id: 'a', summary: 'Holiday', start: { date: '2026-06-16' }, end: { date: '2026-06-17' } },
      'Australia/Sydney',
    );
    expect(allDay.summary).toBe('Holiday');
    expect(allDay.start).toContain('all day');

    const timed = formatCalendarEvent(
      {
        id: 'b',
        summary: 'Standup',
        start: { dateTime: '2026-06-16T00:30:00Z' },
        end: { dateTime: '2026-06-16T01:00:00Z' },
      },
      'Australia/Sydney',
    );
    expect(timed.start).toContain('2026-06-16');
  });

  it('parses reminder fields from API responses', () => {
    const defaults = formatCalendarEvent({
      id: 'c',
      summary: 'Defaults',
      start: { dateTime: '2026-06-16T00:30:00Z' },
      end: { dateTime: '2026-06-16T01:00:00Z' },
      reminders: { useDefault: true },
    });
    expect(defaults.useDefaultReminders).toBe(true);

    const custom = formatCalendarEvent({
      id: 'd',
      summary: 'Custom',
      start: { dateTime: '2026-06-16T00:30:00Z' },
      end: { dateTime: '2026-06-16T01:00:00Z' },
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 30 }, { method: 'popup', minutes: 10 }],
      },
    });
    expect(custom.popupReminderMinutes).toEqual([30, 10]);

    const cleared = formatCalendarEvent({
      id: 'e',
      summary: 'Cleared',
      start: { dateTime: '2026-06-16T00:30:00Z' },
      end: { dateTime: '2026-06-16T01:00:00Z' },
      reminders: { useDefault: false, overrides: [] },
    });
    expect(cleared.popupReminderMinutes).toEqual([]);
  });
});

describe('summarizeEvents', () => {
  it('renders a friendly empty state', () => {
    expect(summarizeEvents([])).toBe('No calendar events found.');
  });

  it('includes event ids for follow-up writes', () => {
    const text = summarizeEvents([
      {
        id: 'evt-1',
        summary: 'Lunch',
        start: '2026-06-16 12:00 AEST',
        end: '2026-06-16 13:00 AEST',
      },
    ]);

    expect(text).toContain('Lunch');
    expect(text).toContain('evt-1');
  });

  it('renders reminder display cases', () => {
    const defaults = summarizeEvents([
      {
        id: 'evt-2',
        summary: 'Defaults',
        start: '2026-06-16 12:00 AEST',
        end: '2026-06-16 13:00 AEST',
        useDefaultReminders: true,
      },
    ]);
    expect(defaults).toContain('Reminders: calendar defaults');

    const none = summarizeEvents([
      {
        id: 'evt-3',
        summary: 'None',
        start: '2026-06-16 12:00 AEST',
        end: '2026-06-16 13:00 AEST',
        popupReminderMinutes: [],
      },
    ]);
    expect(none).toContain('Reminders: none');

    const custom = summarizeEvents([
      {
        id: 'evt-4',
        summary: 'Custom',
        start: '2026-06-16 12:00 AEST',
        end: '2026-06-16 13:00 AEST',
        popupReminderMinutes: [30, 10],
      },
    ]);
    expect(custom).toContain('Reminders: 30 min before, 10 min before');
  });
});

describe('summarizeFreeBusy', () => {
  it('renders busy intervals per calendar', () => {
    const text = summarizeFreeBusy([
      {
        calendarId: 'primary',
        start: '2026-06-16 09:00 AEST',
        end: '2026-06-16 10:00 AEST',
      },
    ]);

    expect(text).toContain('primary');
    expect(text).toContain('09:00');
  });
});

describe('calendar API wrappers', () => {
  it('lists events on a date via the injected calendar client', async () => {
    const listMock = vi.fn(() =>
      Promise.resolve({
        data: {
          items: [
            {
              id: 'evt-1',
              summary: 'Meeting',
              start: { dateTime: '2026-06-16T00:00:00Z' },
              end: { dateTime: '2026-06-16T01:00:00Z' },
            },
          ],
        },
      }),
    );

    const calendarApi = {
      events: { list: listMock },
      freebusy: { query: vi.fn() },
    } as unknown as CalendarApi;

    const events = await listEventsOnDate('token', '2026-06-16', {}, calendarApi);

    expect(events).toHaveLength(1);
    expect(events[0]?.summary).toBe('Meeting');
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: 'primary',
        singleEvents: true,
        orderBy: 'startTime',
      }),
    );
  });

  it('creates events via the injected calendar client', async () => {
    const insertMock = vi.fn(() =>
      Promise.resolve({
        data: {
          id: 'new-evt',
          summary: 'Dentist',
          start: { dateTime: '2026-06-16T02:00:00Z', timeZone: 'Australia/Sydney' },
          end: { dateTime: '2026-06-16T03:00:00Z', timeZone: 'Australia/Sydney' },
        },
      }),
    );

    const calendarApi = {
      events: { insert: insertMock, list: vi.fn(), patch: vi.fn(), delete: vi.fn() },
      freebusy: { query: vi.fn() },
    } as unknown as CalendarApi;

    const created = await createCalendarEvent(
      'token',
      {
        summary: 'Dentist',
        start: '2026-06-16T12:00:00',
        end: '2026-06-16T13:00:00',
      },
      calendarApi,
    );

    expect(created.id).toBe('new-evt');
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it('sends popup reminders on create when reminderMinutes is provided', async () => {
    const insertMock = vi.fn(() =>
      Promise.resolve({
        data: {
          id: 'new-evt',
          summary: 'Dentist',
          start: { dateTime: '2026-06-16T02:00:00Z', timeZone: 'Australia/Sydney' },
          end: { dateTime: '2026-06-16T03:00:00Z', timeZone: 'Australia/Sydney' },
          reminders: {
            useDefault: false,
            overrides: [{ method: 'popup', minutes: 30 }],
          },
        },
      }),
    );

    const calendarApi = {
      events: { insert: insertMock, list: vi.fn(), patch: vi.fn(), delete: vi.fn() },
      freebusy: { query: vi.fn() },
    } as unknown as CalendarApi;

    await createCalendarEvent(
      'token',
      {
        summary: 'Dentist',
        start: '2026-06-16T12:00:00',
        end: '2026-06-16T13:00:00',
        reminderMinutes: [30],
      },
      calendarApi,
    );

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          reminders: {
            useDefault: false,
            overrides: [{ method: 'popup', minutes: 30 }],
          },
        }),
      }),
    );
  });

  it('omits reminders on create when reminderMinutes is not provided', async () => {
    const insertMock = vi.fn(() =>
      Promise.resolve({
        data: {
          id: 'new-evt',
          summary: 'Dentist',
          start: { dateTime: '2026-06-16T02:00:00Z', timeZone: 'Australia/Sydney' },
          end: { dateTime: '2026-06-16T03:00:00Z', timeZone: 'Australia/Sydney' },
        },
      }),
    );

    const calendarApi = {
      events: { insert: insertMock, list: vi.fn(), patch: vi.fn(), delete: vi.fn() },
      freebusy: { query: vi.fn() },
    } as unknown as CalendarApi;

    await createCalendarEvent(
      'token',
      {
        summary: 'Dentist',
        start: '2026-06-16T12:00:00',
        end: '2026-06-16T13:00:00',
      },
      calendarApi,
    );

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.not.objectContaining({
          reminders: expect.anything(),
        }),
      }),
    );
  });

  it('throws when reminderMinutes is invalid on create', async () => {
    const calendarApi = {
      events: { insert: vi.fn(), list: vi.fn(), patch: vi.fn(), delete: vi.fn() },
      freebusy: { query: vi.fn() },
    } as unknown as CalendarApi;

    await expect(
      createCalendarEvent(
        'token',
        {
          summary: 'Dentist',
          start: '2026-06-16T12:00:00',
          end: '2026-06-16T13:00:00',
          reminderMinutes: [30, 20, 15, 10, 5, 1],
        },
        calendarApi,
      ),
    ).rejects.toThrow('reminderMinutes: at most 5 reminders are allowed.');

    await expect(
      createCalendarEvent(
        'token',
        {
          summary: 'Dentist',
          start: '2026-06-16T12:00:00',
          end: '2026-06-16T13:00:00',
          reminderMinutes: [50000],
        },
        calendarApi,
      ),
    ).rejects.toThrow('reminderMinutes: each value must be between 0 and 40320 minutes.');
  });

  it('patches reminders on update when reminderMinutes is provided', async () => {
    const patchMock = vi.fn(() =>
      Promise.resolve({
        data: {
          id: 'evt-1',
          summary: 'Dentist',
          start: { dateTime: '2026-06-16T02:00:00Z', timeZone: 'Australia/Sydney' },
          end: { dateTime: '2026-06-16T03:00:00Z', timeZone: 'Australia/Sydney' },
          reminders: { useDefault: false, overrides: [] },
        },
      }),
    );

    const calendarApi = {
      events: { insert: vi.fn(), list: vi.fn(), patch: patchMock, delete: vi.fn() },
      freebusy: { query: vi.fn() },
    } as unknown as CalendarApi;

    await updateCalendarEvent(
      'token',
      {
        eventId: 'evt-1',
        reminderMinutes: [],
      },
      calendarApi,
    );

    expect(patchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt-1',
        requestBody: expect.objectContaining({
          reminders: {
            useDefault: false,
            overrides: [],
          },
        }),
      }),
    );
  });
});

/**
 * Network calls to Google Calendar are not unit-tested here; the injected
 * `CalendarApi` stub exercises request shaping without googleapis HTTP.
 */
