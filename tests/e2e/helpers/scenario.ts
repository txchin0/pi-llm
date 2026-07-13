import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import { expect, inject } from 'vitest';

import { resolveUserMemoryWorkspace } from '../../../src/config/agentLlm.js';
import type {
  RespondSseEvent,
  RespondToolCallEvent,
  RespondToolResultEvent,
} from '../../../src/contracts/respond.js';
import type { TaskRecord } from '../../../src/queue/taskTypes.js';
import { authHeaders } from '../../helpers/auth.js';

import { resetFakeExaCalls } from '../fakes/fakeExaMcpClient.js';
import { runJudge, truncateForJudge, type JudgeResult } from './judge.js';
import type { E2eAppHandle } from './buildE2eApp.js';
import {
  writeFragment,
  type CheckOutcome,
  type CheckSeverity,
  type ScenarioFragment,
  type TaskSummary,
  type TurnTranscript,
} from './report.js';
import { parseSse } from './sse.js';
import { waitForTerminalTask } from './waitForTask.js';

/*
 * Scenario file convention: every `tests/e2e/scenarios/*.e2e.test.ts` MUST
 * install the external-tool fakes at the top of the file, before any imports
 * of app code take effect:
 *
 *   vi.mock('../../../src/integrations/google/loadGoogleApis.js', () =>
 *     import('../fakes/fakeGoogleApis.js'));
 *   vi.mock('../../../src/integrations/webSearch/exaMcpClient.js', () =>
 *     import('../fakes/fakeExaMcpClient.js'));
 *
 * Without them the LLM's tool calls would reach real Google/Exa endpoints.
 */

export type CheckResult = {
  pass: boolean;
  evidence: string;
};

export type ScenarioCheck = {
  name: string;
  severity: CheckSeverity;
  run(run: ScenarioRun): CheckResult | Promise<CheckResult>;
};

export type ScenarioTurn = {
  message: string;
  /** Starts a fresh surface session for this turn. */
  newSession?: boolean;
  /**
   * After the turn, extracts the task id from the `schedule_task` tool result
   * and waits until the worker drives it to a terminal status. `true` fails
   * the scenario when no task was scheduled; `'optional'` accepts either
   * outcome (e.g. an idempotent request the model may rightly not re-schedule)
   * but still waits for the task when one exists.
   */
  awaitTask?: boolean | 'optional';
};

export type SetupContext = {
  handle: E2eAppHandle;
  userId: string;
  /** Toggles one integration for the scenario user via `PUT /v1/integrations`. */
  setIntegrationEnabled(integrationId: string, enabled: boolean): Promise<void>;
  /** Writes a file into the scenario user's memory workspace. */
  seedMemoryFile(relativePath: string, content: string): Promise<void>;
};

export type E2eScenario = {
  /** Kebab-case id; becomes the fragment filename and scenario user id. */
  id: string;
  title: string;
  turns: ScenarioTurn[];
  /** Asserts that no background task was queued during the scenario. */
  expectNoTasks?: boolean;
  setup?(ctx: SetupContext): Promise<void>;
  checks: ScenarioCheck[];
  judge?: {
    /** Rubric criteria, one plain-language statement per entry. */
    rubric: string[];
    /** Extra evidence (e.g. workspace contents) appended to the transcript. */
    evidence?(run: ScenarioRun): Promise<string> | string;
  };
  /** Overrides the run-wide E2E_TRIALS for this scenario. */
  trials?: number;
};

export type TurnOutcome = {
  message: string;
  sessionId: string;
  events: RespondSseEvent[];
  assistantText: string;
  toolCalls: RespondToolCallEvent[];
  toolResults: RespondToolResultEvent[];
  durationMs: number;
};

export type WorkspaceMatch = {
  file: string;
  line: number;
  text: string;
};

export type ScenarioRun = {
  userId: string;
  handle: E2eAppHandle;
  turns: TurnOutcome[];
  /** Concatenated assistant text of the final turn. */
  finalText: string;
  allToolCalls: RespondToolCallEvent[];
  /** Terminal task records collected by `awaitTask` turns, in order. */
  tasks: TaskRecord[];
  /** Reads the user's memory workspace as relative-path -> content. */
  readWorkspaceFiles(): Promise<Map<string, string>>;
  /** Greps the memory workspace, returning every matching line. */
  grepWorkspace(pattern: RegExp): Promise<WorkspaceMatch[]>;
};

const TASK_ID_PATTERN = /Task queued \(id: ([^)]+)\)/;
const TASK_ID_DETAILS_PATTERN = /"task_id"\s*:\s*"([^"]+)"/;
const ALL_TASK_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;

/** Caps check evidence so the report stays readable. */
function truncateEvidence(text: string, maxChars = 600): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

/** Generates a contract-valid surface session id. */
function newSessionId(): string {
  return `sess_e2e${randomBytes(9).toString('hex')}`;
}

/** Extracts the queued task id from a turn's schedule_task tool result. */
function extractScheduledTaskId(
  toolResults: RespondToolResultEvent[],
): string | undefined {
  for (const result of toolResults) {
    if (result.tool_name !== 'schedule_task') {
      continue;
    }

    const serialized = JSON.stringify(result.output) ?? '';
    const idMatch = TASK_ID_PATTERN.exec(serialized);
    if (idMatch?.[1] !== undefined) {
      return idMatch[1];
    }

    const detailsMatch = TASK_ID_DETAILS_PATTERN.exec(serialized);
    if (detailsMatch?.[1] !== undefined) {
      return detailsMatch[1];
    }
  }

  return undefined;
}

/**
 * Runs a scenario against the shared e2e app: registers a fresh user, drives
 * the respond endpoint turn by turn, waits for worker outcomes, evaluates the
 * scenario checks plus standing SSE-contract checks, runs the (soft) judge,
 * and writes a result fragment for the run report.
 *
 * Only failed `must` checks fail the vitest test; `should` checks and judge
 * scores are recorded in the report (the judge warns below score 70 and only
 * gates when E2E_JUDGE_THRESHOLD is set).
 */
export async function runScenario(
  handle: E2eAppHandle,
  scenario: E2eScenario,
): Promise<void> {
  const runDir = inject('e2eRunDir');
  const meta = inject('e2eMeta');
  const trials = scenario.trials ?? meta.trials;
  const failures: string[] = [];

  for (let trial = 0; trial < trials; trial += 1) {
    const fragment = await runTrial(handle, scenario, trial);
    await writeFragment(runDir, fragment);

    const failedMust = fragment.checks.filter(
      (check) => check.severity === 'must' && !check.pass,
    );
    if (failedMust.length > 0) {
      failures.push(
        `trial ${trial + 1}: ${failedMust
          .map((check) => `[${check.name}] ${check.evidence}`)
          .join(' | ')}`,
      );
    }
  }

  expect(
    failures,
    `scenario "${scenario.id}" failed must-checks (see report fragments in ${runDir})`,
  ).toEqual([]);
}

/** Runs one trial of a scenario and returns its report fragment. */
async function runTrial(
  handle: E2eAppHandle,
  scenario: E2eScenario,
  trial: number,
): Promise<ScenarioFragment> {
  const meta = inject('e2eMeta');
  const startedAt = Date.now();
  const checks: CheckOutcome[] = [];
  const turns: TurnOutcome[] = [];
  const tasks: TaskRecord[] = [];

  // Fresh state per trial: fakes are module singletons shared across scenarios.
  handle.fakes.calendar.reset();
  resetFakeExaCalls();

  const userId = trial === 0 ? `e2e-${scenario.id}` : `e2e-${scenario.id}-t${trial + 1}`;
  const auth = await authHeaders(handle.app, userId);
  const workspaceDir = resolveUserMemoryWorkspace(handle.dataRoot, userId);

  const record = (
    name: string,
    severity: CheckSeverity,
    pass: boolean,
    evidence: string,
  ): void => {
    checks.push({ name, severity, pass, evidence: truncateEvidence(evidence) });
  };

  if (scenario.setup !== undefined) {
    await scenario.setup({
      handle,
      userId,
      async setIntegrationEnabled(integrationId, enabled) {
        const response = await handle.app.inject({
          method: 'PUT',
          url: '/v1/integrations',
          headers: { 'content-type': 'application/json', ...auth },
          payload: { integrations: { [integrationId]: { enabled } } },
        });
        if (response.statusCode !== 200) {
          throw new Error(
            `failed to set integration ${integrationId}=${String(enabled)}: ${response.body}`,
          );
        }
      },
      async seedMemoryFile(relativePath, content) {
        const filePath = join(workspaceDir, relativePath);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content, 'utf8');
      },
    });
  }

  let sessionId = newSessionId();
  let usageInputTokens = 0;
  let usageOutputTokens = 0;

  for (const [index, turn] of scenario.turns.entries()) {
    const label = `turn ${index + 1}`;
    if (turn.newSession === true && index > 0) {
      sessionId = newSessionId();
    }

    const turnStartedAt = Date.now();
    const response = await handle.app.inject({
      method: 'POST',
      url: '/v1/respond',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
        ...auth,
      },
      payload: { session_id: sessionId, message: turn.message },
    });
    const durationMs = Date.now() - turnStartedAt;

    if (response.statusCode !== 200) {
      record(
        `${label}: http status`,
        'must',
        false,
        `expected 200, got ${response.statusCode}: ${response.body}`,
      );
      break;
    }

    const { events, issues } = parseSse(response.body);
    const toolCalls = events.filter((event) => event.type === 'tool_call');
    const toolResults = events.filter((event) => event.type === 'tool_result');
    const assistantText = events
      .filter((event) => event.type === 'delta')
      .map((event) => event.text)
      .join('');

    for (const event of events) {
      if (event.type === 'usage') {
        usageInputTokens += event.usage.input_tokens;
        usageOutputTokens += event.usage.output_tokens;
      }
    }

    turns.push({
      message: turn.message,
      sessionId,
      events,
      assistantText,
      toolCalls,
      toolResults,
      durationMs,
    });

    // Standing contract checks applied to every turn.
    record(
      `${label}: sse frames valid`,
      'must',
      issues.length === 0,
      issues.length === 0
        ? `${events.length} valid frames`
        : issues.map((issue) => issue.issue).join('; '),
    );
    const lifecycleOk =
      events[0]?.type === 'start' &&
      events.some((event) => event.type === 'final');
    record(
      `${label}: stream lifecycle`,
      'must',
      lifecycleOk,
      lifecycleOk
        ? 'start first, final present'
        : `event types: ${events.map((event) => event.type).join(', ')}`,
    );
    const errorEvents = events.filter((event) => event.type === 'error');
    record(
      `${label}: no error events`,
      'must',
      errorEvents.length === 0,
      errorEvents.length === 0
        ? 'no errors'
        : errorEvents.map((event) => `${event.code}: ${event.message}`).join('; '),
    );

    if (turn.awaitTask !== undefined) {
      const taskId = extractScheduledTaskId(toolResults);
      if (turn.awaitTask === true) {
        record(
          `${label}: schedule_task queued`,
          'must',
          taskId !== undefined,
          taskId !== undefined
            ? `task ${taskId}`
            : `no schedule_task result found; tools called: ${
                toolCalls.map((call) => call.tool_name).join(', ') || '(none)'
              }`,
        );
      } else if (taskId === undefined) {
        record(
          `${label}: schedule_task optional`,
          'should',
          true,
          'no task scheduled (allowed for this turn)',
        );
      }

      if (taskId !== undefined) {
        try {
          const task = await waitForTerminalTask(handle.taskQueue, userId, taskId);
          tasks.push(task);
          record(
            `${label}: task reached terminal status`,
            'must',
            true,
            `task ${taskId} -> ${task.status}`,
          );
        } catch (error) {
          record(
            `${label}: task reached terminal status`,
            'must',
            false,
            error instanceof Error ? error.message : 'wait failed',
          );
        }
      }
    }
  }

  if (scenario.expectNoTasks === true) {
    const existing = await handle.taskQueue.listByUser(userId, {
      statuses: [...ALL_TASK_STATUSES],
    });
    record(
      'no tasks created',
      'must',
      existing.length === 0,
      existing.length === 0
        ? 'queue empty for user'
        : existing.map((task) => `${task.id} (${task.status})`).join(', '),
    );
  }

  const run: ScenarioRun = {
    userId,
    handle,
    turns,
    finalText: turns.at(-1)?.assistantText ?? '',
    allToolCalls: turns.flatMap((turn) => turn.toolCalls),
    tasks,
    readWorkspaceFiles: () => readWorkspaceFiles(workspaceDir),
    grepWorkspace: async (pattern) => {
      const files = await readWorkspaceFiles(workspaceDir);
      const matches: WorkspaceMatch[] = [];
      for (const [file, content] of files) {
        content.split('\n').forEach((text, lineIndex) => {
          if (pattern.test(text)) {
            matches.push({ file, line: lineIndex + 1, text });
          }
        });
      }
      return matches;
    },
  };

  for (const check of scenario.checks) {
    try {
      const result = await check.run(run);
      record(check.name, check.severity, result.pass, result.evidence);
    } catch (error) {
      record(
        check.name,
        check.severity,
        false,
        `check threw: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  const judge = await maybeRunJudge(scenario, run);
  if (judge !== null && judge.status === 'ok') {
    const threshold = meta.judgeThreshold;
    if (threshold !== null) {
      record(
        'judge score above threshold',
        'must',
        judge.score >= threshold,
        `score ${judge.score} vs threshold ${threshold}`,
      );
    } else if (judge.score < 70) {
      console.warn(
        `[e2e] judge scored "${scenario.id}" at ${judge.score}/100 (report-only)`,
      );
    }
  }

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    trial,
    status: checks.some((check) => check.severity === 'must' && !check.pass)
      ? 'failed'
      : 'passed',
    durationMs: Date.now() - startedAt,
    usage: { inputTokens: usageInputTokens, outputTokens: usageOutputTokens },
    checks,
    judge,
    transcript: turns.map(toTurnTranscript),
    tasks: tasks.map(toTaskSummary),
  };
}

/** Runs the LLM judge when enabled and the scenario declares a rubric. */
async function maybeRunJudge(
  scenario: E2eScenario,
  run: ScenarioRun,
): Promise<JudgeResult | null> {
  if (scenario.judge === undefined) {
    return null;
  }

  const meta = inject('e2eMeta');
  if (meta.judgeMode === 'off') {
    return { status: 'skipped' };
  }

  const extraEvidence =
    scenario.judge.evidence !== undefined
      ? await scenario.judge.evidence(run)
      : undefined;

  return runJudge({
    baseUrl: meta.judgeBaseUrl,
    modelId: meta.judgeModelId,
    apiKey: meta.judgeApiKey,
    rubric: scenario.judge.rubric,
    transcript: buildJudgeTranscript(run, extraEvidence),
  });
}

/** Builds the judge input from turns, task outcomes, and extra evidence. */
function buildJudgeTranscript(run: ScenarioRun, extraEvidence?: string): string {
  const parts: string[] = [];

  run.turns.forEach((turn, index) => {
    parts.push(`## Turn ${index + 1}`);
    parts.push(`USER: ${truncateForJudge(turn.message, 500)}`);
    if (turn.toolCalls.length > 0) {
      parts.push(
        `TOOLS CALLED: ${turn.toolCalls.map((call) => call.tool_name).join(', ')}`,
      );
    }
    parts.push(`ASSISTANT: ${truncateForJudge(turn.assistantText)}`);
  });

  for (const task of run.tasks) {
    parts.push(`## Background task outcome (${task.status})`);
    parts.push(
      truncateForJudge(task.result ?? task.errorMessage ?? '(no result)', 1500),
    );
  }

  if (extraEvidence !== undefined && extraEvidence.trim() !== '') {
    parts.push('## Additional evidence');
    parts.push(truncateForJudge(extraEvidence));
  }

  return parts.join('\n');
}

/** Reads every file in the workspace directory (empty map when absent). */
async function readWorkspaceFiles(
  workspaceDir: string,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  let entries;
  try {
    entries = await readdir(workspaceDir, { recursive: true, withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const fullPath = join(entry.parentPath, entry.name);
    const relativePath = relative(workspaceDir, fullPath).replaceAll('\\', '/');
    files.set(relativePath, await readFile(fullPath, 'utf8'));
  }

  return files;
}

function toTurnTranscript(turn: TurnOutcome): TurnTranscript {
  return {
    user: turn.message,
    assistantText: turn.assistantText,
    toolCalls: turn.toolCalls.map((call) => ({
      name: call.tool_name,
      input: call.input,
    })),
  };
}

function toTaskSummary(task: TaskRecord): TaskSummary {
  return {
    id: task.id,
    status: task.status,
    description: task.description,
    result: task.result,
    errorMessage: task.errorMessage,
  };
}
