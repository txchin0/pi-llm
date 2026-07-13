import { DateTime } from 'luxon';

import type { calendar_v3 } from 'googleapis';

/**
 * Drop-in replacement for `src/integrations/google/loadGoogleApis.ts`,
 * installed per scenario file with:
 *
 *   vi.mock('../../../src/integrations/google/loadGoogleApis.js', () =>
 *     import('../fakes/fakeGoogleApis.js'));
 *
 * The real module's only consumers call `createGoogleAuth(...)` and then
 * `google.calendar({ version: 'v3', auth })`, so this fake serves a
 * `CalendarApi`-shaped object backed by the in-memory `fakeCalendarStore`.
 * Tests seed and inspect the store directly to assert calendar outcomes.
 */

type Schema$Event = calendar_v3.Schema$Event;

export type SeedEventInput = {
  summary: string;
  startIso: string;
  endIso: string;
  description?: string;
  location?: string;
};

/** Parses an event boundary (dateTime or all-day date) to a Luxon instant. */
function parseEventBoundary(
  boundary: calendar_v3.Schema$EventDateTime | undefined | null,
): DateTime | null {
  if (boundary === undefined || boundary === null) {
    return null;
  }

  if (boundary.dateTime !== undefined && boundary.dateTime !== null) {
    const parsed = DateTime.fromISO(boundary.dateTime, { setZone: true });
    return parsed.isValid ? parsed : null;
  }

  if (boundary.date !== undefined && boundary.date !== null) {
    const parsed = DateTime.fromISO(boundary.date, { zone: 'utc' });
    return parsed.isValid ? parsed : null;
  }

  return null;
}

/** In-memory Google Calendar event store with google-shaped list filtering. */
export class FakeCalendarStore {
  private events: Schema$Event[] = [];
  private nextId = 1;

  /** Adds an event directly (test setup), returning the stored record. */
  seed(input: SeedEventInput): Schema$Event {
    return this.insertEvent({
      summary: input.summary,
      start: { dateTime: input.startIso },
      end: { dateTime: input.endIso },
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
    });
  }

  /** Returns all stored events. */
  list(): readonly Schema$Event[] {
    return this.events;
  }

  /** Returns the first event whose summary matches the pattern. */
  findBySummary(pattern: RegExp): Schema$Event | undefined {
    return this.events.find((event) => pattern.test(event.summary ?? ''));
  }

  /** Clears all events (called between scenario trials). */
  reset(): void {
    this.events = [];
  }

  /** google `events.insert`: stores the request body with a generated id. */
  insertEvent(body: Schema$Event): Schema$Event {
    const stored: Schema$Event = {
      status: 'confirmed',
      ...body,
      id: `fake-evt-${this.nextId}`,
    };
    this.nextId += 1;
    this.events.push(stored);
    return stored;
  }

  /** google `events.patch`: merges fields into an existing event. */
  patchEvent(eventId: string, body: Schema$Event): Schema$Event {
    const existing = this.events.find((event) => event.id === eventId);
    if (existing === undefined) {
      throw new Error(`fake calendar: no event with id ${eventId}`);
    }

    Object.assign(existing, body);
    return existing;
  }

  /** google `events.delete`: removes an event by id. */
  deleteEvent(eventId: string): void {
    this.events = this.events.filter((event) => event.id !== eventId);
  }

  /** google `events.list`: window-intersection plus free-text filtering. */
  listEvents(params: {
    timeMin?: string | null;
    timeMax?: string | null;
    q?: string | null;
    maxResults?: number | null;
  }): Schema$Event[] {
    const timeMin = params.timeMin
      ? DateTime.fromISO(params.timeMin, { setZone: true })
      : null;
    const timeMax = params.timeMax
      ? DateTime.fromISO(params.timeMax, { setZone: true })
      : null;
    const query = params.q?.trim().toLowerCase();

    const matches = this.events.filter((event) => {
      const start = parseEventBoundary(event.start);
      const end = parseEventBoundary(event.end) ?? start;
      if (start === null) {
        return false;
      }

      if (timeMin !== null && end !== null && end <= timeMin) {
        return false;
      }
      if (timeMax !== null && start >= timeMax) {
        return false;
      }
      if (query !== undefined && query !== '') {
        const haystack = `${event.summary ?? ''} ${event.description ?? ''}`.toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }

      return true;
    });

    matches.sort((a, b) => {
      const aStart = parseEventBoundary(a.start)?.toMillis() ?? 0;
      const bStart = parseEventBoundary(b.start)?.toMillis() ?? 0;
      return aStart - bStart;
    });

    return matches.slice(0, params.maxResults ?? 250);
  }

  /** google `freebusy.query`: busy intervals per requested calendar id. */
  freeBusy(requestBody: calendar_v3.Schema$FreeBusyRequest): Record<
    string,
    { busy: Array<{ start: string; end: string }> }
  > {
    const calendars: Record<string, { busy: Array<{ start: string; end: string }> }> = {};
    const windowEvents = this.listEvents({
      timeMin: requestBody.timeMin ?? null,
      timeMax: requestBody.timeMax ?? null,
    });

    for (const item of requestBody.items ?? []) {
      const calendarId = item.id ?? 'primary';
      calendars[calendarId] = {
        busy: windowEvents.flatMap((event) => {
          const start = parseEventBoundary(event.start);
          const end = parseEventBoundary(event.end);
          if (start === null || end === null) {
            return [];
          }
          return [{ start: start.toUTC().toISO() ?? '', end: end.toUTC().toISO() ?? '' }];
        }),
      };
    }

    return calendars;
  }
}

export const fakeCalendarStore = new FakeCalendarStore();

const fakeCalendarApi = {
  events: {
    list: (params: calendar_v3.Params$Resource$Events$List) =>
      Promise.resolve({ data: { items: fakeCalendarStore.listEvents(params) } }),
    insert: (params: calendar_v3.Params$Resource$Events$Insert) =>
      Promise.resolve({ data: fakeCalendarStore.insertEvent(params.requestBody ?? {}) }),
    patch: (params: calendar_v3.Params$Resource$Events$Patch) =>
      Promise.resolve({
        data: fakeCalendarStore.patchEvent(params.eventId ?? '', params.requestBody ?? {}),
      }),
    delete: (params: calendar_v3.Params$Resource$Events$Delete) => {
      fakeCalendarStore.deleteEvent(params.eventId ?? '');
      return Promise.resolve({ data: {} });
    },
  },
  freebusy: {
    query: (params: calendar_v3.Params$Resource$Freebusy$Query) =>
      Promise.resolve({
        data: { calendars: fakeCalendarStore.freeBusy(params.requestBody ?? {}) },
      }),
  },
};

/** Fails loudly if a scenario ever reaches Google Tasks without a dedicated fake. */
function unsupportedTasksApi(): never {
  throw new Error('Google Tasks is not faked for e2e; add a fake before enabling it');
}

const fakeGoogle = {
  auth: {
    OAuth2: class FakeOAuth2 {
      setCredentials(): void {
        // Token is irrelevant; the store is process-local.
      }
    },
  },
  calendar: () => fakeCalendarApi,
  tasks: () => ({
    tasklists: { list: unsupportedTasksApi },
    tasks: { list: unsupportedTasksApi, insert: unsupportedTasksApi },
  }),
};

/** Drop-in for the real module's `loadGoogleApis`. */
export function loadGoogleApis(): Promise<{ google: typeof fakeGoogle }> {
  return Promise.resolve({ google: fakeGoogle });
}

/** Drop-in for the real module's startup warm hook. */
export async function warmGoogleApisIfConfigured(): Promise<void> {
  // Nothing to warm; the fake is synchronous in-memory state.
}

/** Drop-in for the real module's `createGoogleAuth` (token is ignored). */
export function createGoogleAuth(): Promise<{
  google: typeof fakeGoogle;
  auth: InstanceType<typeof fakeGoogle.auth.OAuth2>;
}> {
  return Promise.resolve({ google: fakeGoogle, auth: new fakeGoogle.auth.OAuth2() });
}
