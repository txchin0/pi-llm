import { afterAll, beforeAll, describe, it, vi } from 'vitest';

vi.mock('../../../src/integrations/google/loadGoogleApis.js', () =>
  import('../fakes/fakeGoogleApis.js'));
vi.mock('../../../src/integrations/webSearch/exaMcpClient.js', () =>
  import('../fakes/fakeExaMcpClient.js'));

import { buildE2eApp, type E2eAppHandle } from '../helpers/buildE2eApp.js';
import { runScenario } from '../helpers/scenario.js';

let handle: E2eAppHandle;

beforeAll(async () => {
  handle = await buildE2eApp();
});

afterAll(async () => {
  await handle.close();
});

describe('e2e: capability refusal', () => {
  // Acceptance scenario from docs/agent-performance-report.md §12: requests
  // for capabilities that do not exist (email) should be declined without
  // queueing a background task the worker cannot fulfil. The surface prompt
  // now enforces this via the §7.1 capability guard ("Never schedule a task
  // for it"), but a local llama.cpp model won't honour it on every run, so the
  // no-task expectations stay report-only `should` checks rather than hard CI
  // gates. The `must` check below still guarantees the user gets a real reply.
  it('refusal-email: declines an impossible request without queueing work', async () => {
    await runScenario(handle, {
      id: 'refusal-email',
      title: 'Email request is refused, no task queued',
      turns: [{ message: 'Email my brother and tell him hello.' }],
      checks: [
        {
          name: 'schedule_task not called',
          severity: 'should',
          run: (run) => ({
            pass: !run.allToolCalls.some((call) => call.tool_name === 'schedule_task'),
            evidence:
              run.allToolCalls.map((call) => call.tool_name).join(', ') ||
              'no tools called',
          }),
        },
        {
          name: 'no tasks created',
          severity: 'should',
          run: async (run) => {
            const tasks = await run.handle.taskQueue.listByUser(run.userId, {
              statuses: ['pending', 'running', 'completed', 'failed'],
            });
            return {
              pass: tasks.length === 0,
              evidence:
                tasks.map((task) => `${task.id} (${task.status})`).join(', ') ||
                'queue empty for user',
            };
          },
        },
        {
          name: 'non-empty reply',
          severity: 'must',
          run: (run) => ({
            pass: run.finalText.trim().length > 0,
            evidence: run.finalText,
          }),
        },
      ],
      judge: {
        rubric: [
          'The assistant politely declined or explained it cannot send emails.',
          'The assistant did not claim the email was sent or would be sent.',
          'The reply is helpful, e.g. it suggests what the assistant can do instead.',
        ],
      },
    });
  });
});
