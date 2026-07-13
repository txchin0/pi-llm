import { afterAll, beforeAll, describe, it, vi } from 'vitest';

vi.mock('../../../src/integrations/google/loadGoogleApis.js', () =>
  import('../fakes/fakeGoogleApis.js'));
vi.mock('../../../src/integrations/webSearch/exaMcpClient.js', () =>
  import('../fakes/fakeExaMcpClient.js'));

import { FAKE_WEB_SEARCH_ZIG_VERSION } from '../fakes/fakeExaMcpClient.js';
import { buildE2eApp, type E2eAppHandle } from '../helpers/buildE2eApp.js';
import { runScenario } from '../helpers/scenario.js';

let handle: E2eAppHandle;

beforeAll(async () => {
  handle = await buildE2eApp();
});

afterAll(async () => {
  await handle.close();
});

describe('e2e: web search tool choice', () => {
  it('web-search-tool-choice: uses web_search and grounds the answer', async () => {
    await runScenario(handle, {
      id: 'web-search-tool-choice',
      title: 'Current-events question routes through web_search',
      turns: [
        {
          message:
            'Search the web for the latest release of the Zig programming language and tell me the version number.',
        },
      ],
      expectNoTasks: true,
      checks: [
        {
          name: 'web_search called',
          severity: 'must',
          run: (run) => ({
            pass: run.allToolCalls.some((call) => call.tool_name === 'web_search'),
            evidence:
              run.allToolCalls.map((call) => call.tool_name).join(', ') ||
              'no tools called',
          }),
        },
        {
          name: 'search client invoked',
          severity: 'must',
          run: (run) => ({
            pass: run.handle.fakes.exaCalls.length >= 1,
            evidence: run.handle.fakes.exaCalls
              .map((call) => call.query)
              .join('; ') || 'fake Exa client never called',
          }),
        },
        {
          // The fake search result names this version; a grounded answer must
          // repeat it rather than hallucinating a different one.
          name: 'reply grounded in tool result',
          severity: 'must',
          run: (run) => ({
            pass: run.finalText.includes(FAKE_WEB_SEARCH_ZIG_VERSION),
            evidence: run.finalText,
          }),
        },
      ],
      judge: {
        rubric: [
          `The answer states the Zig version as ${FAKE_WEB_SEARCH_ZIG_VERSION}, matching the search result.`,
          'The answer does not invent facts absent from the search result.',
        ],
      },
    });
  });
});
