# Google Calendar integration

Agent reference for `calendar_read` (surface) and `calendar_write` (worker). Implementation lives in this folder; OAuth is gated per role in `index.ts`.

## OAuth scopes

| Role | Scope | Purpose |
|------|-------|---------|
| Surface | `https://www.googleapis.com/auth/calendar.readonly` | List events, query free/busy |
| Worker | `https://www.googleapis.com/auth/calendar.events` | Create, update, delete events |

Official scope list: [Calendar API authorization](https://developers.google.com/calendar/api/auth)

## Conventions

- **Calendar id**: All API calls default to `primary` (the authenticated user's primary calendar). Not exposed on tool schemas today.
- **Timezone**: Dates and datetimes are interpreted in `env.TIMEZONE` (default `Australia/Sydney`). Sent to Google as RFC3339 UTC or all-day `date` fields.
- **Datetime input**: ISO date (`YYYY-MM-DD`) or ISO datetime (`YYYY-MM-DDTHH:mm` or full RFC3339). Date-only without `T` creates an all-day event.
- **Tool output**: Plain text summaries with event id, title, when, location, description, reminders (when Google includes them). Write tools echo `event id` for idempotent retries.

---

## `calendar_read` tool schema

Registered in `calendarReadTool.ts`. Surface agent only.

```typescript
{
  mode?: 'upcoming' | 'on_date' | 'range' | 'free_busy';  // default: 'upcoming'
  date?: string;           // YYYY-MM-DD — required for on_date; optional shortcut for free_busy
  timeMin?: string;        // ISO date or datetime — required for range; optional for free_busy
  timeMax?: string;        // ISO date or datetime — required for range; optional for free_busy
  maxResults?: number;     // 1–50, default 10 — upcoming, on_date, range only
  calendarIds?: string[];  // free_busy only; default ['primary']
}
```

### Modes

| Mode | Required params | Behavior |
|------|-----------------|----------|
| `upcoming` | (none) | Events from now onward, ordered by start time |
| `on_date` | `date` | All events on that calendar day in app timezone |
| `range` | `timeMin`, `timeMax` | Events whose start falls in the window |
| `free_busy` | `date` **or** (`timeMin` + `timeMax`) | Busy intervals (not full event details) |

### Examples

```json
{ "mode": "upcoming", "maxResults": 5 }
```

```json
{ "mode": "on_date", "date": "2026-06-20" }
```

```json
{ "mode": "range", "timeMin": "2026-06-20", "timeMax": "2026-06-27" }
```

```json
{ "mode": "free_busy", "date": "2026-06-20" }
```

```json
{ "mode": "free_busy", "timeMin": "2026-06-20T09:00", "timeMax": "2026-06-20T17:00", "calendarIds": ["primary"] }
```

---

## `calendar_write` tool schema

Registered in `calendarWriteTool.ts`. Worker agent only.

```typescript
{
  action: 'create' | 'update' | 'delete';  // required
  eventId?: string;      // required for update and delete
  summary?: string;      // title — required for create
  description?: string;
  location?: string;
  start?: string;        // ISO date or datetime — required for create
  end?: string;          // ISO date or datetime — required for create
  reminderMinutes?: number[];  // popup reminders N minutes before start; omit = calendar defaults, [] = clear
  skipDuplicateCheck?: boolean;  // default false — create only
}
```

### Actions

| Action | Required params | Optional params | Notes |
|--------|-----------------|-----------------|-------|
| `create` | `summary`, `start`, `end` | `description`, `location`, `reminderMinutes`, `skipDuplicateCheck` | Before insert, searches for existing event with same title + start (±1 min). Returns existing id if found unless `skipDuplicateCheck: true`. |
| `update` | `eventId` | `summary`, `description`, `location`, `start`, `end`, `reminderMinutes` | Partial update — only supplied fields change. |
| `delete` | `eventId` | — | Permanently removes the event. |

### Reminder semantics (`reminderMinutes`)

| Tool input | Google `reminders` body |
|------------|-------------------------|
| Omitted | Not sent — calendar default reminders apply |
| `[30, 10]` | `{ useDefault: false, overrides: [{ method: 'popup', minutes: 30 }, …] }` |
| `[]` | `{ useDefault: false, overrides: [] }` — clears reminders |

On update, omit `reminderMinutes` to leave existing reminders unchanged. Each value must be an integer from 0 to 40320; at most 5 entries.

Write responses and `calendar_read` list output show reminder info when Google includes it in the event payload.

### Examples

```json
{
  "action": "create",
  "summary": "Dentist",
  "start": "2026-06-25T14:00",
  "end": "2026-06-25T15:00",
  "location": "123 Main St",
  "reminderMinutes": [60, 15]
}
```

```json
{
  "action": "update",
  "eventId": "abc123",
  "start": "2026-06-25T15:00",
  "end": "2026-06-25T16:00",
  "reminderMinutes": [30]
}
```

```json
{ "action": "delete", "eventId": "abc123" }
```

---

## Google Calendar API requests (what we call)

Client: `calendarClient.ts` via `googleapis` (`calendar` v3). Base URL: `https://www.googleapis.com/calendar/v3`.

### 1. `events.list` — list / search events

**HTTP:** `GET /calendars/{calendarId}/events`

**Used by:** `upcoming`, `on_date`, `range`, and duplicate-check search on create.

| Our argument | Google parameter | Value we send |
|--------------|------------------|---------------|
| `calendarId` (internal) | `calendarId` | `"primary"` |
| `maxResults` | `maxResults` | Tool value or `10` |
| `timeMin` | `timeMin` | RFC3339 UTC |
| `timeMax` | `timeMax` | RFC3339 UTC |
| duplicate search | `q` | Event `summary` text |
| (fixed) | `singleEvents` | `true` — expand recurring instances |
| (fixed) | `orderBy` | `"startTime"` |

**Not passed today** (available on the API): `pageToken`, `syncToken`, `q` (except duplicate check), `iCalUID`, `updatedMin`, `showDeleted`, `showHiddenInvitations`, `timeZone`, `maxAttendees`, `eventTypes`, `privateExtendedProperty`, `sharedExtendedProperty`.

Docs: [events.list](https://developers.google.com/calendar/api/v3/reference/events/list)

#### Full `events.list` query parameters (API reference)

| Parameter | Type | Description |
|-----------|------|-------------|
| `calendarId` | string | Calendar id or `"primary"` |
| `timeMin` | datetime | Lower bound (exclusive) on event **end** time; RFC3339 with offset |
| `timeMax` | datetime | Upper bound (exclusive) on event **start** time; must be > `timeMin` |
| `maxResults` | integer | Page size (default 250, max 2500) |
| `pageToken` | string | Pagination |
| `singleEvents` | boolean | Expand recurring events into instances |
| `orderBy` | string | `"startTime"` or `"updated"` (requires `singleEvents=true` for `startTime`) |
| `q` | string | Free-text search (title, description, location, etc.) |
| `iCalUID` | string | Filter by iCalendar UID |
| `updatedMin` | datetime | Only events updated after this time |
| `syncToken` | string | Incremental sync token |
| `showDeleted` | boolean | Include cancelled events |
| `timeZone` | string | Time zone for expanded instances |

---

### 2. `freebusy.query` — availability

**HTTP:** `POST /freeBusy`

**Used by:** `free_busy` mode.

**Request body we send:**

```json
{
  "timeMin": "<RFC3339>",
  "timeMax": "<RFC3339>",
  "items": [{ "id": "primary" }]
}
```

| Our argument | Google field | Notes |
|--------------|--------------|-------|
| `timeMin` | `timeMin` | Required |
| `timeMax` | `timeMax` | Required |
| `calendarIds` | `items[].id` | Default `["primary"]` |

**Not passed today:** `timeZone`, `groupExpansionMax`, `calendarExpansionMax`.

**Response used:** `calendars[id].busy[]` with `{ start, end }` per busy block.

Docs: [freebusy.query](https://developers.google.com/calendar/api/v3/reference/freebusy/query)

---

### 3. `events.insert` — create event

**HTTP:** `POST /calendars/{calendarId}/events`

**Used by:** `calendar_write` action `create`.

| Our argument | Event body field | Notes |
|--------------|------------------|-------|
| `summary` | `summary` | Title |
| `description` | `description` | Optional |
| `location` | `location` | Optional |
| `start` | `start` | `{ date }` all-day or `{ dateTime, timeZone }` timed |
| `end` | `end` | Same shape as `start` |
| `reminderMinutes` | `reminders` | `{ useDefault: false, overrides: [{ method: 'popup', minutes }] }`; omitted = calendar defaults |

**Not passed today:** attendees, recurrence, `conferenceData`, `colorId`, `visibility`, `sendUpdates`, etc.

Docs: [events.insert](https://developers.google.com/calendar/api/v3/reference/events/insert)

#### Event `start` / `end` shapes (API)

Timed event:

```json
{
  "dateTime": "2026-06-25T04:00:00Z",
  "timeZone": "Australia/Sydney"
}
```

All-day event:

```json
{ "date": "2026-06-25" }
```

---

### 4. `events.patch` — update event

**HTTP:** `PATCH /calendars/{calendarId}/events/{eventId}`

**Used by:** `calendar_write` action `update`. Patch semantics — omitted fields stay unchanged.

| Path / body | Source |
|-------------|--------|
| `calendarId` | `"primary"` |
| `eventId` | Tool `eventId` |
| `summary`, `description`, `location`, `start`, `end`, `reminderMinutes` | Only fields provided on the tool call |

Docs: [events.patch](https://developers.google.com/calendar/api/v3/reference/events/patch)

---

### 5. `events.delete` — delete event

**HTTP:** `DELETE /calendars/{calendarId}/events/{eventId}`

**Used by:** `calendar_write` action `delete`.

| Parameter | Value |
|-----------|-------|
| `calendarId` | `"primary"` |
| `eventId` | Tool `eventId` |

Docs: [events.delete](https://developers.google.com/calendar/api/v3/reference/events/delete)

---

## Full Calendar API surface (not wired yet)

For extending this integration, the v3 API also exposes:

| Resource | Methods | Typical use |
|----------|---------|-------------|
| [Events](https://developers.google.com/calendar/api/v3/reference/events) | `get`, `import`, `instances`, `move`, `quickAdd`, `update`, `watch` | Single-event fetch, recurrence instances, move between calendars, natural-language quick add |
| [CalendarList](https://developers.google.com/calendar/api/v3/reference/calendarList) | `list`, `get`, `insert`, `delete`, `patch`, `update` | List user's calendars, pick non-primary ids |
| [Calendars](https://developers.google.com/calendar/api/v3/reference/calendars) | `get`, `insert`, `patch`, `update`, `delete`, `clear` | Calendar metadata, secondary calendars |
| [Acl](https://developers.google.com/calendar/api/v3/reference/acl) | CRUD + `watch` | Sharing permissions |
| [Colors](https://developers.google.com/calendar/api/v3/reference/colors) | `get` | Event/calendar color ids |
| [Settings](https://developers.google.com/calendar/api/v3/reference/settings) | `get`, `list` | User preferences |
| [Channels](https://developers.google.com/calendar/api/v3/reference/channels) | `stop` | Push notification watches |

Master reference: [Calendar API v3 reference](https://developers.google.com/calendar/api/v3/reference)

Guides:

- [Calendars & events concepts](https://developers.google.com/calendar/api/concepts)
- [Recurrence (RRULE)](https://developers.google.com/calendar/api/guides/recurringevents)
- [Sync tokens / incremental sync](https://developers.google.com/calendar/api/guides/sync)

---

## Call graph (tool → client → API)

```
calendar_read
  upcoming     → listUpcomingEvents     → events.list
  on_date      → listEventsOnDate       → events.list
  range        → listUpcomingEvents     → events.list
  free_busy    → queryFreeBusy          → freebusy.query

calendar_write
  create       → findExisting… (optional) → events.list
               → createCalendarEvent     → events.insert
  update       → updateCalendarEvent     → events.patch
  delete       → deleteCalendarEvent     → events.delete
```

---

## Extending tools

When adding parameters:

1. Add to the TypeBox schema in `calendarReadTool.ts` or `calendarWriteTool.ts`.
2. Thread through to `calendarClient.ts` types and API params.
3. Update this file and integration tests under `tests/integrations/googleCalendar/`.
4. If a new scope is required, update `index.ts` `oauth.scopes` and reconnect flow.
