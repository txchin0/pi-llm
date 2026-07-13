import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, it, vi } from 'vitest';

vi.mock('../../../src/integrations/google/loadGoogleApis.js', () =>
  import('../fakes/fakeGoogleApis.js'));
vi.mock('../../../src/integrations/webSearch/exaMcpClient.js', () =>
  import('../fakes/fakeExaMcpClient.js'));

import { buildE2eApp, type E2eAppHandle } from '../helpers/buildE2eApp.js';
import { runScenario, type ScenarioRun } from '../helpers/scenario.js';

let handle: E2eAppHandle;
let indexTemplate: string;

beforeAll(async () => {
  handle = await buildE2eApp();
  indexTemplate = await readFile(
    join(process.cwd(), 'templates', 'user-memory', 'index.md'),
    'utf8',
  );
});

afterAll(async () => {
  await handle.close();
});

/** Dumps the memory workspace for judge evidence. */
async function workspaceEvidence(run: ScenarioRun): Promise<string> {
  const files = await run.readWorkspaceFiles();
  return [...files]
    .map(([file, content]) => `### ${file}\n${content}`)
    .join('\n');
}

describe('e2e: memory workspace (surface -> queue -> worker)', () => {
  // Acceptance scenario from docs/agent-performance-report.md §12: a "remember
  // this" request must defer to the worker, which persists the fact and
  // updates the index.
  it('memory-remember-fact: fact is persisted by the worker', async () => {
    await runScenario(handle, {
      id: 'memory-remember-fact',
      title: 'Remember a personal fact end to end',
      turns: [{ message: 'Remember that I hate mushrooms.', awaitTask: true }],
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
          name: 'fact recorded in workspace',
          severity: 'must',
          run: async (run) => {
            const matches = await run.grepWorkspace(/mushroom/i);
            return {
              pass: matches.length > 0,
              evidence:
                matches.map((match) => `${match.file}:${match.line} ${match.text}`).join('; ') ||
                'no workspace line mentions mushrooms',
            };
          },
        },
        {
          name: 'index updated from template',
          severity: 'must',
          run: async (run) => {
            const files = await run.readWorkspaceFiles();
            const index = files.get('index.md');
            return {
              pass: index !== undefined && index.trim() !== indexTemplate.trim(),
              evidence: index ?? 'index.md missing',
            };
          },
        },
      ],
      judge: {
        rubric: [
          'The stored memory records the dislike of mushrooms as a concise fact about the user.',
          'The memory entry is dated or otherwise traceable to when it was stored.',
          'The index file gained a row pointing at the topic file that holds the fact.',
          'The chat reply acknowledged the request without inventing details.',
        ],
        evidence: workspaceEvidence,
      },
    });
  });

  // §12 idempotency scenario: repeating the same fact in a fresh session must
  // not duplicate the entry.
  it('memory-idempotent-duplicate: repeated fact is not duplicated', async () => {
    await runScenario(handle, {
      id: 'memory-idempotent-duplicate',
      title: 'Duplicate fact across sessions stays deduplicated',
      turns: [
        { message: 'Remember that I like hamburgers.', awaitTask: true },
        {
          // A fresh session already sees the stored fact, so the model may
          // legitimately skip re-scheduling — dedup at the surface is as
          // valid as a worker no-op. Only the workspace outcome is asserted.
          message: 'Remember that I like hamburgers.',
          newSession: true,
          awaitTask: 'optional',
        },
      ],
      checks: [
        {
          name: 'all scheduled tasks completed',
          severity: 'must',
          run: (run) => ({
            pass:
              run.tasks.length >= 1 &&
              run.tasks.every((task) => task.status === 'completed'),
            evidence: run.tasks
              .map((task) => `${task.id}: ${task.status}`)
              .join('; '),
          }),
        },
        {
          name: 'fact recorded in workspace',
          severity: 'must',
          run: async (run) => {
            const matches = await run.grepWorkspace(/hamburger/i);
            return {
              pass: matches.length > 0,
              evidence:
                matches.map((match) => `${match.file}:${match.line}`).join('; ') ||
                'no workspace line mentions hamburgers',
            };
          },
        },
        {
          // One fact bullet plus one index row is the expected footprint; more
          // matching lines indicate the second run appended a duplicate.
          name: 'no duplicate entries',
          severity: 'should',
          run: async (run) => {
            const matches = await run.grepWorkspace(/hamburger/i);
            return {
              pass: matches.length <= 2,
              evidence: matches
                .map((match) => `${match.file}:${match.line} ${match.text}`)
                .join('; '),
            };
          },
        },
      ],
      judge: {
        rubric: [
          'The hamburger preference is stored as one entry in one topic file. A row in index.md pointing at that topic file is expected and does NOT count as a duplicate.',
          'No topic file contains two separate entries recording the same hamburger preference.',
        ],
        evidence: workspaceEvidence,
      },
    });
  });
});
