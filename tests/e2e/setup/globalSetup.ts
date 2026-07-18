import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { TestProject } from 'vitest/node';

import { checkAgentLlmEndpoint } from '../../../src/config/agentLlm.js';
import { resolveE2eRuntimeConfig } from '../helpers/e2eEnv.js';
import { renderHtmlReport } from '../helpers/htmlReport.js';
import { buildRunMeta, mergeFragments, printSummary } from '../helpers/report.js';

/** Returns the current git SHA, or null outside a usable git checkout. */
function resolveGitSha(): string | null {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** Makes a model id safe to use as a directory-name suffix. */
function sanitizeForPath(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, '-');
}

/**
 * Fails fast when the configured LLM endpoints are unreachable, then prepares
 * the per-run results directory. Teardown merges scenario fragments into
 * `report.json`, renders the browsable `report.html`, and prints the summary
 * table.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const config = await resolveE2eRuntimeConfig();

  for (const role of ['surface', 'worker'] as const) {
    const result = await checkAgentLlmEndpoint(config[role], role);
    if (!result.ok) {
      throw new Error(
        `${result.message}\n` +
          'The e2e suite requires a live LLM endpoint. Start llama-server ' +
          '(or point E2E_LLM_BASE_URL at a running OpenAI-compatible server) and retry.',
      );
    }
  }

  const startedAt = new Date().toISOString();
  const runDir = join(
    process.cwd(),
    'tests',
    'e2e',
    'results',
    `${startedAt.replaceAll(/[:.]/g, '-')}_${sanitizeForPath(config.surface.modelId)}`,
  );
  await mkdir(join(runDir, 'fragments'), { recursive: true });

  const meta = buildRunMeta(config, { startedAt, gitSha: resolveGitSha() });
  project.provide('e2eRunDir', runDir);
  project.provide('e2eMeta', meta);

  console.log(`[e2e] model: ${config.surface.modelId} @ ${config.surface.baseUrl}`);
  console.log(`[e2e] results: ${runDir}`);

  return async () => {
    const report = await mergeFragments(runDir, meta);
    await writeFile(join(runDir, 'report.html'), renderHtmlReport(report), 'utf8');
    printSummary(report, runDir);
  };
}
