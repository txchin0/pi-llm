import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AgentLlmConfig } from '../../../src/config/agentLlm.js';
import type { E2eRuntimeConfig } from './e2eEnv.js';
import type { JudgeResult } from './judge.js';
import type { WorkerAttemptTrace } from './workerTrace.js';

export type CheckSeverity = 'must' | 'should';

export type CheckOutcome = {
  name: string;
  severity: CheckSeverity;
  pass: boolean;
  evidence: string;
};

export type TranscriptToolCall = {
  name: string;
  input: unknown;
  /** Paired tool result payload; null when no result frame arrived. */
  output: unknown;
  isError: boolean;
};

export type TurnTranscript = {
  user: string;
  /** Surface-agent thinking streamed for this turn ('' when none). */
  thinking: string;
  assistantText: string;
  toolCalls: TranscriptToolCall[];
};

export type TaskSummary = {
  id: string;
  status: string;
  description: string;
  result: string | null;
  errorMessage: string | null;
  /** Worker trace per attempt: thinking, tool steps, usage, and outcome. */
  attempts: WorkerAttemptTrace[];
};

export type ScenarioFragment = {
  scenarioId: string;
  title: string;
  trial: number;
  status: 'passed' | 'failed';
  durationMs: number;
  usage: { inputTokens: number; outputTokens: number };
  checks: CheckOutcome[];
  judge: JudgeResult | null;
  /** Rubric criteria the judge graded against (null when no judge declared). */
  judgeRubric: string[] | null;
  /** Exact transcript handed to the judge (null when the judge did not run). */
  judgeInput: string | null;
  transcript: TurnTranscript[];
  tasks: TaskSummary[];
};

/**
 * Caps a tool payload's serialized size so report fragments stay readable.
 * Oversized payloads are replaced by a truncated JSON string with a marker.
 */
export function capPayload(value: unknown, maxChars = 8000): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? 'undefined';
  } catch {
    return '[unserializable payload]';
  }

  if (serialized.length <= maxChars) {
    return value;
  }

  return `${serialized.slice(0, maxChars)}… [truncated ${serialized.length - maxChars} chars]`;
}

type RoleMeta = Pick<
  AgentLlmConfig,
  'baseUrl' | 'modelId' | 'contextWindow' | 'maxTokens' | 'thinkingEnabled' | 'thinkingLevel'
>;

export type E2eRunMeta = {
  startedAt: string;
  gitSha: string | null;
  trials: number;
  judgeMode: 'warn' | 'off';
  judgeThreshold: number | null;
  judgeBaseUrl: string;
  judgeModelId: string;
  judgeApiKey: string;
  surface: RoleMeta;
  worker: RoleMeta;
  workerTaskTimeoutMs: number;
};

export type E2eReport = {
  meta: E2eRunMeta & { completedAt: string };
  scenarios: ScenarioFragment[];
};

declare module 'vitest' {
  export interface ProvidedContext {
    e2eRunDir: string;
    e2eMeta: E2eRunMeta;
  }
}

/** Picks the report-relevant fields from one role's LLM config. */
function toRoleMeta(config: AgentLlmConfig): RoleMeta {
  return {
    baseUrl: config.baseUrl,
    modelId: config.modelId,
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
    thinkingEnabled: config.thinkingEnabled,
    thinkingLevel: config.thinkingLevel,
  };
}

/** Builds run metadata recorded in the report and provided to test workers. */
export function buildRunMeta(
  config: E2eRuntimeConfig,
  options: { startedAt: string; gitSha: string | null },
): E2eRunMeta {
  return {
    startedAt: options.startedAt,
    gitSha: options.gitSha,
    trials: config.trials,
    judgeMode: config.judge.mode,
    judgeThreshold: config.judge.threshold ?? null,
    judgeBaseUrl: config.judge.baseUrl,
    judgeModelId: config.judge.modelId,
    judgeApiKey: config.judge.apiKey,
    surface: toRoleMeta(config.surface),
    worker: toRoleMeta(config.worker),
    workerTaskTimeoutMs: config.workerTaskTimeoutMs,
  };
}

/** Writes one scenario trial's result fragment into the run directory. */
export async function writeFragment(
  runDir: string,
  fragment: ScenarioFragment,
): Promise<void> {
  const path = join(
    runDir,
    'fragments',
    `${fragment.scenarioId}-t${fragment.trial}.json`,
  );
  await writeFile(path, JSON.stringify(fragment, null, 2), 'utf8');
}

/** Merges all trial fragments into `report.json` and returns the report. */
export async function mergeFragments(
  runDir: string,
  meta: E2eRunMeta,
): Promise<E2eReport> {
  const fragmentsDir = join(runDir, 'fragments');
  const scenarios: ScenarioFragment[] = [];

  let entries: string[] = [];
  try {
    entries = await readdir(fragmentsDir);
  } catch {
    // No fragments (setup failed before any scenario ran); report stays empty.
  }

  for (const entry of entries.filter((name) => name.endsWith('.json')).sort()) {
    const raw = await readFile(join(fragmentsDir, entry), 'utf8');
    scenarios.push(JSON.parse(raw) as ScenarioFragment);
  }

  const report: E2eReport = {
    meta: { ...meta, completedAt: new Date().toISOString() },
    scenarios,
  };

  await writeFile(join(runDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  return report;
}

/** Formats one summary table cell, padded to the column width. */
function cell(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width);
}

/** Counts passing checks of one severity as a `passed/total` string. */
function checkRatio(checks: CheckOutcome[], severity: CheckSeverity): string {
  const relevant = checks.filter((check) => check.severity === severity);
  if (relevant.length === 0) {
    return '-';
  }

  const passed = relevant.filter((check) => check.pass).length;
  return `${passed}/${relevant.length}`;
}

/** Prints a per-scenario summary table to the console after the run. */
export function printSummary(report: E2eReport, runDir: string): void {
  const columns = [32, 6, 8, 8, 7, 10, 14] as const;
  const header = [
    cell('scenario', columns[0]),
    cell('trial', columns[1]),
    cell('status', columns[2]),
    cell('must', columns[3]),
    cell('should', columns[4]),
    cell('judge', columns[5]),
    cell('time/tokens', columns[6]),
  ].join('  ');

  const lines = report.scenarios.map((fragment) => {
    const judgeScore =
      fragment.judge?.status === 'ok' ? String(fragment.judge.score) : '-';
    const seconds = (fragment.durationMs / 1000).toFixed(1);
    const tokens = `${fragment.usage.inputTokens}/${fragment.usage.outputTokens}`;

    return [
      cell(fragment.scenarioId, columns[0]),
      cell(String(fragment.trial + 1), columns[1]),
      cell(fragment.status, columns[2]),
      cell(checkRatio(fragment.checks, 'must'), columns[3]),
      cell(checkRatio(fragment.checks, 'should'), columns[4]),
      cell(judgeScore, columns[5]),
      cell(`${seconds}s ${tokens}`, columns[6]),
    ].join('  ');
  });

  const model = report.meta.surface.modelId;
  console.log('');
  console.log(`e2e run summary (model: ${model})`);
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const line of lines) {
    console.log(line);
  }
  console.log('');
  console.log(`full report: ${join(runDir, 'report.json')}`);
  console.log(`html report: ${join(runDir, 'report.html')}`);
}
