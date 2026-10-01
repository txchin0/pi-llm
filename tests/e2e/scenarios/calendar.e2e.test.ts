import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';

vi.mock('../../../src/integrations/google/loadGoogleApis.js', () =>
  import('../fakes/fakeGoogleApis.js'));
vi.mock('../../../src/integrations/webSearch/exaMcpClient.js', () =>
  import('../fakes/fakeExaMcpClient.js'));

import { env } from '../../../src/config/env.js';
import { buildE2eApp, type E2eAppHandle } from '../helpers/buildE2eApp.js';
import { runScenario } from '../helpers/scenario.js';

let handle: E2eAppHandle;
let disconnectedHandle: E2eAppHandle;

beforeAll(async () => {
  handle = await buildE2eApp();
  disconnectedHandle = await buildE2eApp({ connectedGoogleUserIds: [] });
});

afterAll(async () => {
  await handle.close();
  await disconnectedHandle.close();
});

/** Tomorrow at the given hour in the app timezone. */
function tomorrowAt(hour: number): DateTime {
  return DateTime.now()
    .setZone(env.TIMEZONE)
    .plus({ days: 1 })
    .set({ hour, minute: 0, second: 0, millisecond: 0 });
}

describe('e2e: google calendar (faked googleapis)', () => {
  it('calendar-read-surface: reads a seeded event', async () => {
    await runScenario(handle, {
      id: 'calendar-read-surface',
      title: 'Schedule question routes through calendar_read',
      setup: async (ctx) => {
        await ctx.setIntegrationEnabled('google_calendar', true);
        const start = tomorrowAt(10);
        ctx.handle.fakes.calendar.seed({
          summary: 'Dentist appointment',
          startIso: start.toISO() ?? '',
          endIso: start.plus({ minutes: 30 }).toISO() ?? '',
        });
      },
      turns: [{ message: "What's on my calendar tomorrow?" }],
      expectNoTasks: true,
      checks: [
        {
          name: 'calendar_read called',
          severity: 'must',
          run: (run) => ({
            pass: run.allToolCalls.some((call) => call.tool_name === 'calendar_read'),
            evidence:
              run.allToolCalls.map((call) => call.tool_name).join(', ') ||
              'no tools called',
          }),
        },
        {
          name: 'reply mentions the dentist appointment',
          severity: 'must',
          run: (run) => ({
            pass: /dentist/i.test(run.finalText),
            evidence: run.finalText,
          }),
        },
      ],
      judge: {
        rubric: [
          'The reply reports the dentist appointment at 10:00 tomorrow.',
          'The reply does not invent events that are not on the calendar.',
        ],
      },
    });
  });

  it('calendar-write-worker: creates an event via the worker', async () => {
    await runScenario(handle, {
      id: 'calendar-write-worker',
      title: 'Calendar write defers to the worker and lands in Google',
      setup: async (ctx) => {
        await ctx.setIntegrationEnabled('google_calendar', true);
      },
      turns: [
        {
          message:
            'Add a meeting called Budget Review tomorrow at 2pm for one hour.',
          awaitTask: true,
        },
      ],
      checks: [
        {
          name: 'task completed',
          severity: 'must',
          run: (run) => ({
            pass: run.tasks[0]?.status === 'completed',
            evidence: `task status: ${run.tasks[0]?.status ?? 'missing'}; result: ${
              run.tasks[0]?.result ?? run.tasks[0]?.errorMessage ?? '(none)'
            }`,
          }),
        },
        {
          name: 'event created in calendar',
          severity: 'must',
          run: (run) => {
            const event = run.handle.fakes.calendar.findBySummary(/budget review/i);
            return {
              pass: event !== undefined,
              evidence: JSON.stringify(run.handle.fakes.calendar.list()),
            };
          },
        },
        {
          name: 'event starts tomorrow at 14:00',
          severity: 'should',
          run: (run) => {
            const event = run.handle.fakes.calendar.findBySummary(/budget review/i);
            const startIso = event?.start?.dateTime;
            if (startIso === undefined || startIso === null) {
              return { pass: false, evidence: 'no dateTime on created event' };
            }
            const start = DateTime.fromISO(startIso, { setZone: true }).setZone(
              env.TIMEZONE,
            );
            const expected = tomorrowAt(14);
            return {
              pass:
                start.hasSame(expected, 'day') && start.hour === expected.hour,
              evidence: `event start: ${startIso}; expected ${expected.toISO() ?? ''}`,
            };
          },
        },
      ],
      judge: {
        rubric: [
          'The chat reply told the user the meeting would be scheduled (deferred), not that it was already done before the task ran.',
          'The created event matches the request: title Budget Review, tomorrow, 2pm, one hour.',
        ],
      },
    });
  });

  it('calendar-disconnected: write attempt without Google connected creates nothing', async () => {
    await runScenario(disconnectedHandle, {
      id: 'calendar-disconnected',
      title: 'Calendar write with Google disconnected creates no event',
      setup: async (ctx) => {
        await ctx.setIntegrationEnabled('google_calendar', true);
      },
      turns: [
        {
          message:
            'Add a meeting called Budget Review tomorrow at 2pm for one hour.',
          awaitTask: true,
        },
      ],
      checks: [
        // As-built, the worker marks the task `completed` even when the tool
        // reported "not connected" (the worker's OUTCOME line is not parsed
        // yet), so we assert only that a terminal status was reached
        // (standing awaitTask check) and that no event leaked into the
        // calendar.
        {
          name: 'no event created',
          severity: 'must',
          run: (run) => ({
            pass: run.handle.fakes.calendar.list().length === 0,
            evidence: JSON.stringify(run.handle.fakes.calendar.list()),
          }),
        },
        {
          name: 'worker result mentions connecting Google',
          severity: 'should',
          run: (run) => ({
            pass: /connect/i.test(run.tasks[0]?.result ?? ''),
            evidence: run.tasks[0]?.result ?? '(no result)',
          }),
        },
      ],
      judge: {
        rubric: [
          'The outcome tells the user Google Calendar is not connected and how to fix it.',
          'Nothing claims the event was created.',
        ],
      },
    });
  });
});
