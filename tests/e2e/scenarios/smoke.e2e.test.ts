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

describe('e2e: smoke', () => {
  it('smoke-basic-chat: plain reply with no tool use', async () => {
    await runScenario(handle, {
      id: 'smoke-basic-chat',
      title: 'Basic chat reply without tool use',
      turns: [{ message: 'Reply with exactly the word: pineapple' }],
      expectNoTasks: true,
      checks: [
        {
          name: 'no tool calls',
          severity: 'must',
          run: (run) => ({
            pass: run.allToolCalls.length === 0,
            evidence:
              run.allToolCalls.map((call) => call.tool_name).join(', ') ||
              'no tools called',
          }),
        },
        {
          name: 'reply contains pineapple',
          severity: 'must',
          run: (run) => ({
            pass: /pineapple/i.test(run.finalText),
            evidence: run.finalText,
          }),
        },
        {
          name: 'usage reported',
          severity: 'must',
          run: (run) => ({
            pass: run.turns.some((turn) =>
              turn.events.some((event) => event.type === 'usage'),
            ),
            evidence: 'usage event presence in SSE stream',
          }),
        },
      ],
    });
  });
});
