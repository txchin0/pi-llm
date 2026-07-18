import type { JudgeResult } from './judge.js';
import type {
  CheckOutcome,
  E2eReport,
  ScenarioFragment,
  TaskSummary,
  TranscriptToolCall,
  TurnTranscript,
} from './report.js';
import type { WorkerAttemptTrace, WorkerTimelineEntry } from './workerTrace.js';

/*
 * Self-contained HTML report for one e2e run: run overview, per-scenario
 * results, the full surface conversation (with thinking), the worker trace
 * per task attempt (with thinking), and the judge verdict with its reasoning.
 * No external assets; opens directly from tests/e2e/results/<run>/report.html.
 */

type StatusTone = 'good' | 'warning' | 'critical' | 'neutral';

/** Escapes text for safe interpolation into HTML. */
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** Formats an integer with thousands separators. */
function fmtInt(value: number): string {
  return value.toLocaleString('en-US');
}

/** Formats a millisecond duration as ms, seconds, or minutes. */
function fmtDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** Formats an input/output token pair. */
function fmtTokens(inputTokens: number, outputTokens: number): string {
  return `${fmtInt(inputTokens)} in / ${fmtInt(outputTokens)} out`;
}

/** Renders a status chip: colored dot + label (meaning never color-alone). */
function chip(tone: StatusTone, label: string): string {
  return `<span class="chip ${tone}"><span class="dot"></span>${esc(label)}</span>`;
}

/** Renders a pass/fail verdict cell with icon + word. */
function verdict(pass: boolean): string {
  return pass
    ? '<span class="verdict pass">&#10003; pass</span>'
    : '<span class="verdict fail">&#10007; fail</span>';
}

/** Maps a judge score to its status tone (thresholds match the warn cutoff). */
function scoreTone(score: number): StatusTone {
  if (score >= 70) {
    return 'good';
  }
  return score >= 40 ? 'warning' : 'critical';
}

/** Renders a payload (tool input/output) as pretty-printed, escaped JSON. */
function payloadPre(value: unknown): string {
  const text =
    typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? 'null');
  return `<pre class="io">${esc(text)}</pre>`;
}

/** Renders a prose block (user/assistant/thinking text) preserving newlines. */
function proseBlock(
  cssClass: string,
  label: string,
  text: string,
  meta = '',
): string {
  return [
    `<div class="block ${cssClass}">`,
    `<div class="block-label">${esc(label)}${meta === '' ? '' : `<span class="block-meta">${esc(meta)}</span>`}</div>`,
    `<div class="block-body">${esc(text)}</div>`,
    '</div>',
  ].join('');
}

/** Renders one turn's tool call (with its paired result) as a collapsible. */
function renderTranscriptToolCall(call: TranscriptToolCall): string {
  const state = call.isError
    ? '<span class="tool-state fail">&#10007; error</span>'
    : '<span class="tool-state ok">&#10003; ok</span>';

  return [
    '<details class="tool">',
    `<summary><span class="tool-tag">tool</span><code>${esc(call.name)}</code>${state}</summary>`,
    '<div class="io-label">input</div>',
    payloadPre(call.input),
    '<div class="io-label">output</div>',
    payloadPre(call.output),
    '</details>',
  ].join('');
}

/** Renders one conversation turn: user, thinking, tool calls, assistant. */
function renderTurn(turn: TurnTranscript, index: number): string {
  const parts = [`<div class="turn"><div class="turn-label">Turn ${index + 1}</div>`];

  parts.push(proseBlock('user', 'User', turn.user));

  if (turn.thinking.trim() !== '') {
    parts.push(
      '<details class="block thinking-details">',
      `<summary>Surface thinking &middot; ${fmtInt(turn.thinking.length)} chars</summary>`,
      `<pre class="thinking-pre">${esc(turn.thinking)}</pre>`,
      '</details>',
    );
  }

  for (const call of turn.toolCalls) {
    parts.push(renderTranscriptToolCall(call));
  }

  parts.push(
    proseBlock(
      'assistant',
      'Assistant',
      turn.assistantText === '' ? '(no text)' : turn.assistantText,
    ),
  );
  parts.push('</div>');
  return parts.join('');
}

/** Renders a worker tool call/result pair (result may be missing). */
function renderWorkerToolPair(
  call: Extract<WorkerTimelineEntry, { kind: 'tool_call' }>,
  result: Extract<WorkerTimelineEntry, { kind: 'tool_result' }> | undefined,
): string {
  const state =
    result === undefined
      ? '<span class="tool-state">no result</span>'
      : result.isError
        ? '<span class="tool-state fail">&#10007; error</span>'
        : '<span class="tool-state ok">&#10003; ok</span>';

  const parts = [
    '<details class="tool">',
    `<summary><span class="tool-tag">step ${call.step}</span><code>${esc(call.toolName)}</code>${state}</summary>`,
    '<div class="io-label">input</div>',
    payloadPre(call.input),
  ];

  if (result !== undefined) {
    parts.push('<div class="io-label">output</div>', payloadPre(result.output));
  }

  parts.push('</details>');
  return parts.join('');
}

/** Renders one worker attempt: outcome header plus the chronological timeline. */
function renderWorkerAttempt(attempt: WorkerAttemptTrace, count: number): string {
  const tone: StatusTone = attempt.outcome === 'completed' ? 'good' : 'critical';
  const duration =
    attempt.durationMs === null ? '' : ` &middot; ${fmtDuration(attempt.durationMs)}`;
  const label =
    count > 1 ? `Attempt ${attempt.attempt + 1} of ${count}` : 'Worker run';

  const parts = [
    '<details class="attempt" open>',
    `<summary>${esc(label)} ${chip(tone, attempt.outcome)}${duration} &middot; ${esc(
      fmtTokens(attempt.usage.inputTokens, attempt.usage.outputTokens),
    )} tok</summary>`,
    '<div class="timeline">',
  ];

  const entries = attempt.timeline;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    switch (entry.kind) {
      case 'thinking': {
        if (entry.text.trim() === '') {
          break;
        }
        parts.push(
          '<div class="block worker-thinking">',
          `<div class="block-label">Worker thinking<span class="block-meta">${fmtInt(entry.text.length)} chars</span></div>`,
          `<pre class="thinking-pre">${esc(entry.text)}</pre>`,
          '</div>',
        );
        break;
      }
      case 'text': {
        if (entry.text.trim() === '') {
          break;
        }
        parts.push(proseBlock('assistant', 'Worker output', entry.text));
        break;
      }
      case 'tool_call': {
        const next = entries[index + 1];
        if (
          next !== undefined &&
          next.kind === 'tool_result' &&
          next.step === entry.step
        ) {
          parts.push(renderWorkerToolPair(entry, next));
          index += 1;
        } else {
          parts.push(renderWorkerToolPair(entry, undefined));
        }
        break;
      }
      case 'tool_result': {
        // Orphan result (its call record was lost); still show the payload.
        parts.push(
          renderWorkerToolPair(
            { kind: 'tool_call', step: entry.step, toolName: entry.toolName, input: null },
            entry,
          ),
        );
        break;
      }
      case 'error': {
        parts.push(proseBlock('error', 'Agent error', entry.message));
        break;
      }
    }
  }

  parts.push('</div></details>');
  return parts.join('');
}

/** Renders one background task: status, result, and worker attempt traces. */
function renderTask(task: TaskSummary): string {
  const tone: StatusTone = task.status === 'completed' ? 'good' : 'critical';
  const parts = [
    '<div class="task">',
    `<div class="task-head">${chip(tone, task.status)}<code class="task-id">${esc(task.id)}</code></div>`,
    `<div class="task-desc">${esc(task.description)}</div>`,
  ];

  const outcomeText = task.result ?? task.errorMessage;
  if (outcomeText !== null) {
    parts.push(
      proseBlock(
        task.errorMessage !== null && task.result === null ? 'error' : 'assistant',
        task.result !== null ? 'Task result' : 'Task error',
        outcomeText,
      ),
    );
  }

  if (task.attempts.length === 0) {
    parts.push('<p class="note">No worker trace was captured for this task.</p>');
  }
  for (const attempt of task.attempts) {
    parts.push(renderWorkerAttempt(attempt, task.attempts.length));
  }

  parts.push('</div>');
  return parts.join('');
}

/** Renders the checks table for one scenario trial. */
function renderChecks(checks: CheckOutcome[]): string {
  const rows = checks
    .map(
      (check) => `
      <tr>
        <td>${verdict(check.pass)}</td>
        <td><span class="severity">${esc(check.severity)}</span></td>
        <td>${esc(check.name)}</td>
        <td><code class="evidence">${esc(check.evidence)}</code></td>
      </tr>`,
    )
    .join('');

  return `
    <table class="data">
      <thead><tr><th>result</th><th>severity</th><th>check</th><th>evidence</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Renders the judge verdict: score, per-criterion results, and reasoning. */
function renderJudge(
  judge: JudgeResult,
  rubric: string[] | null,
  judgeInput: string | null,
): string {
  if (judge.status === 'skipped') {
    return '<p class="note">Judge skipped (E2E_JUDGE=off).</p>';
  }

  if (judge.status === 'error') {
    const parts = [
      `<p class="note">${chip('critical', 'judge error')} The judge did not return a valid verdict.</p>`,
      '<div class="io-label">raw judge output</div>',
      payloadPre(judge.raw),
    ];
    if (judge.thinking !== undefined && judge.thinking.trim() !== '') {
      parts.push(
        '<div class="block worker-thinking">',
        '<div class="block-label">Judge thinking</div>',
        `<pre class="thinking-pre">${esc(judge.thinking)}</pre>`,
        '</div>',
      );
    }
    return parts.join('');
  }

  const criteriaRows = judge.criteria
    .map((criterion) => {
      const statement = rubric?.[criterion.id - 1] ?? `criterion ${criterion.id}`;
      return `
      <tr>
        <td>${verdict(criterion.pass)}</td>
        <td>${esc(statement)}</td>
        <td>${esc(criterion.reason === '' ? '—' : criterion.reason)}</td>
      </tr>`;
    })
    .join('');

  const parts = [
    `<div class="judge-score">${chip(scoreTone(judge.score), `score ${judge.score} / 100`)}</div>`,
  ];

  if (judge.criteria.length > 0) {
    parts.push(`
      <table class="data">
        <thead><tr><th>result</th><th>criterion</th><th>judge&#39;s reason</th></tr></thead>
        <tbody>${criteriaRows}</tbody>
      </table>`);
  }

  if (judge.thinking.trim() !== '') {
    parts.push(
      '<div class="block worker-thinking">',
      `<div class="block-label">Judge thinking<span class="block-meta">${fmtInt(judge.thinking.length)} chars</span></div>`,
      `<pre class="thinking-pre">${esc(judge.thinking)}</pre>`,
      '</div>',
    );
  } else {
    parts.push('<p class="note">The judge model produced no reasoning stream.</p>');
  }

  if (judgeInput !== null) {
    parts.push(
      '<details class="tool">',
      '<summary>Transcript the judge graded</summary>',
      payloadPre(judgeInput),
      '</details>',
    );
  }

  parts.push(
    '<details class="tool">',
    '<summary>Raw judge verdict</summary>',
    payloadPre(judge.raw),
    '</details>',
  );

  return parts.join('');
}

/** Anchor id for one scenario trial section. */
function anchorId(fragment: ScenarioFragment): string {
  return `s-${fragment.scenarioId}-t${fragment.trial}`;
}

/** Counts passing checks of one severity, or null when none exist. */
function checkCounts(
  checks: CheckOutcome[],
  severity: CheckOutcome['severity'],
): { passed: number; total: number } | null {
  const relevant = checks.filter((check) => check.severity === severity);
  if (relevant.length === 0) {
    return null;
  }
  return {
    passed: relevant.filter((check) => check.pass).length,
    total: relevant.length,
  };
}

/** Renders a passed/total ratio cell, or an em dash when absent. */
function ratioCell(counts: { passed: number; total: number } | null): string {
  if (counts === null) {
    return '—';
  }
  const cls = counts.passed === counts.total ? 'pass' : 'fail';
  return `<span class="${cls}">${counts.passed}/${counts.total}</span>`;
}

/** Sums worker token usage across every task attempt in a fragment. */
function workerUsage(fragment: ScenarioFragment): {
  inputTokens: number;
  outputTokens: number;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const task of fragment.tasks) {
    for (const attempt of task.attempts) {
      inputTokens += attempt.usage.inputTokens;
      outputTokens += attempt.usage.outputTokens;
    }
  }
  return { inputTokens, outputTokens };
}

/** Renders one scenario trial's full detail card. */
function renderScenario(fragment: ScenarioFragment): string {
  const tone: StatusTone = fragment.status === 'passed' ? 'good' : 'critical';
  const worker = workerUsage(fragment);
  const workerNote =
    worker.inputTokens + worker.outputTokens > 0
      ? ` &middot; worker ${esc(fmtTokens(worker.inputTokens, worker.outputTokens))} tok`
      : '';

  const parts = [
    `<section class="scenario" id="${esc(anchorId(fragment))}">`,
    '<div class="scenario-head">',
    `<h2>${esc(fragment.scenarioId)}<span class="trial-tag">trial ${fragment.trial + 1}</span></h2>`,
    `${chip(tone, fragment.status)}<a class="top-link" href="#top">&#8593; top</a>`,
    '</div>',
    `<p class="scenario-title">${esc(fragment.title)}</p>`,
    `<p class="scenario-meta">${esc(fmtDuration(fragment.durationMs))} &middot; surface ${esc(
      fmtTokens(fragment.usage.inputTokens, fragment.usage.outputTokens),
    )} tok${workerNote}</p>`,
    '<h3>Checks</h3>',
    renderChecks(fragment.checks),
    '<h3>Conversation</h3>',
    fragment.transcript.length === 0
      ? '<p class="note">No turns were recorded.</p>'
      : fragment.transcript.map(renderTurn).join(''),
  ];

  if (fragment.tasks.length > 0) {
    parts.push('<h3>Background tasks</h3>');
    parts.push(...fragment.tasks.map(renderTask));
  }

  if (fragment.judge !== null) {
    parts.push('<h3>Judge</h3>');
    parts.push(renderJudge(fragment.judge, fragment.judgeRubric, fragment.judgeInput));
  }

  parts.push('</section>');
  return parts.join('');
}

/** Renders the per-trial summary table linking into the detail sections. */
function renderSummaryTable(scenarios: ScenarioFragment[]): string {
  const rows = scenarios
    .map((fragment) => {
      const judgeCell =
        fragment.judge === null
          ? '—'
          : fragment.judge.status === 'ok'
            ? chip(scoreTone(fragment.judge.score), String(fragment.judge.score))
            : esc(fragment.judge.status);
      const tone: StatusTone = fragment.status === 'passed' ? 'good' : 'critical';

      return `
      <tr>
        <td><a href="#${esc(anchorId(fragment))}">${esc(fragment.scenarioId)}</a></td>
        <td class="num">${fragment.trial + 1}</td>
        <td>${chip(tone, fragment.status)}</td>
        <td class="num">${ratioCell(checkCounts(fragment.checks, 'must'))}</td>
        <td class="num">${ratioCell(checkCounts(fragment.checks, 'should'))}</td>
        <td class="num">${judgeCell}</td>
        <td class="num">${esc(fmtDuration(fragment.durationMs))}</td>
        <td class="num">${esc(fmtTokens(fragment.usage.inputTokens, fragment.usage.outputTokens))}</td>
      </tr>`;
    })
    .join('');

  return `
    <table class="data summary">
      <thead>
        <tr>
          <th>scenario</th><th class="num">trial</th><th>status</th><th class="num">must</th>
          <th class="num">should</th><th class="num">judge</th><th class="num">time</th><th class="num">surface tokens</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Renders the overview stat tiles. */
function renderOverview(report: E2eReport): string {
  const { scenarios } = report;
  const passed = scenarios.filter((fragment) => fragment.status === 'passed').length;
  const failed = scenarios.length - passed;
  const distinct = new Set(scenarios.map((fragment) => fragment.scenarioId)).size;

  let mustPassed = 0;
  let mustTotal = 0;
  let shouldPassed = 0;
  let shouldTotal = 0;
  let surfaceIn = 0;
  let surfaceOut = 0;
  let workerIn = 0;
  let workerOut = 0;
  const judgeScores: number[] = [];

  for (const fragment of scenarios) {
    for (const check of fragment.checks) {
      if (check.severity === 'must') {
        mustTotal += 1;
        mustPassed += check.pass ? 1 : 0;
      } else {
        shouldTotal += 1;
        shouldPassed += check.pass ? 1 : 0;
      }
    }
    surfaceIn += fragment.usage.inputTokens;
    surfaceOut += fragment.usage.outputTokens;
    const worker = workerUsage(fragment);
    workerIn += worker.inputTokens;
    workerOut += worker.outputTokens;
    if (fragment.judge?.status === 'ok') {
      judgeScores.push(fragment.judge.score);
    }
  }

  const wallMs =
    Date.parse(report.meta.completedAt) - Date.parse(report.meta.startedAt);
  const avgJudge =
    judgeScores.length === 0
      ? null
      : Math.round(
          judgeScores.reduce((sum, score) => sum + score, 0) / judgeScores.length,
        );

  const tile = (label: string, value: string, sub = ''): string =>
    [
      '<div class="tile">',
      `<div class="label">${esc(label)}</div>`,
      `<div class="value">${value}</div>`,
      sub === '' ? '' : `<div class="sub">${esc(sub)}</div>`,
      '</div>',
    ].join('');

  const trialsValue =
    failed === 0
      ? `<span class="pass">${scenarios.length} passed</span>`
      : `<span class="fail">${failed} failed</span> <span class="sub-inline">/ ${scenarios.length}</span>`;

  return `
    <div class="tiles">
      ${tile('Trials', trialsValue, `${distinct} scenario${distinct === 1 ? '' : 's'} · ${report.meta.trials} trial${report.meta.trials === 1 ? '' : 's'} each`)}
      ${tile('Must checks', `${fmtInt(mustPassed)}<span class="sub-inline">/${fmtInt(mustTotal)}</span>`, mustPassed === mustTotal ? 'all passing' : `${mustTotal - mustPassed} failing`)}
      ${tile('Should checks', shouldTotal === 0 ? '—' : `${fmtInt(shouldPassed)}<span class="sub-inline">/${fmtInt(shouldTotal)}</span>`, shouldTotal === 0 ? 'none declared' : shouldPassed === shouldTotal ? 'all passing' : `${shouldTotal - shouldPassed} failing`)}
      ${tile('Judge avg', avgJudge === null ? '—' : String(avgJudge), avgJudge === null ? 'nothing graded' : `${judgeScores.length} graded · min ${Math.min(...judgeScores)}`)}
      ${tile('Surface tokens', fmtInt(surfaceIn + surfaceOut), fmtTokens(surfaceIn, surfaceOut))}
      ${tile('Worker tokens', workerIn + workerOut === 0 ? '—' : fmtInt(workerIn + workerOut), workerIn + workerOut === 0 ? 'no worker runs' : fmtTokens(workerIn, workerOut))}
      ${tile('Wall time', Number.isNaN(wallMs) ? '—' : fmtDuration(wallMs))}
    </div>`;
}

/** Renders the run-metadata grid under the page header. */
function renderMeta(report: E2eReport): string {
  const { meta } = report;
  const thinkingLabel = (enabled: boolean, level: string | undefined): string =>
    enabled ? `thinking ${level ?? 'on'}` : 'thinking off';
  const entries: Array<[string, string]> = [
    ['surface model', `${meta.surface.modelId} (${thinkingLabel(meta.surface.thinkingEnabled, meta.surface.thinkingLevel)})`],
    ['worker model', `${meta.worker.modelId} (${thinkingLabel(meta.worker.thinkingEnabled, meta.worker.thinkingLevel)})`],
    [
      'judge',
      `${meta.judgeModelId} (mode ${meta.judgeMode}${meta.judgeThreshold === null ? '' : `, threshold ${meta.judgeThreshold}`})`,
    ],
    ['started', meta.startedAt],
    ['completed', meta.completedAt],
    ['git sha', meta.gitSha === null ? 'unknown' : meta.gitSha.slice(0, 10)],
    ['worker task timeout', fmtDuration(meta.workerTaskTimeoutMs)],
  ];

  return `
    <dl class="meta">
      ${entries
        .map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`)
        .join('')}
    </dl>`;
}

const STYLES = `
  :root {
    color-scheme: light dark;
    --page: #f9f9f7;
    --surface: #fcfcfb;
    --ink: #0b0b0b;
    --secondary: #52514e;
    --muted: #898781;
    --hairline: #e1e0d9;
    --border: rgba(11, 11, 11, 0.1);
    --good: #0ca30c;
    --good-text: #006300;
    --warning: #fab219;
    --critical: #d03b3b;
    --critical-text: #d03b3b;
    --thinking-accent: #4a3aa7;
    --tool-accent: #2a78d6;
    --good-tint: rgba(12, 163, 12, 0.1);
    --warning-tint: rgba(250, 178, 25, 0.14);
    --critical-tint: rgba(208, 59, 59, 0.1);
    --neutral-tint: rgba(137, 135, 129, 0.12);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --page: #0d0d0d;
      --surface: #1a1a19;
      --ink: #ffffff;
      --secondary: #c3c2b7;
      --hairline: #2c2c2a;
      --border: rgba(255, 255, 255, 0.1);
      --good-text: #0ca30c;
      --critical-text: #e66767;
      --thinking-accent: #9085e9;
      --tool-accent: #3987e5;
      --good-tint: rgba(12, 163, 12, 0.16);
      --warning-tint: rgba(250, 178, 25, 0.16);
      --critical-tint: rgba(208, 59, 59, 0.18);
      --neutral-tint: rgba(137, 135, 129, 0.2);
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--page);
    color: var(--ink);
    font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 28px 20px 80px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 0; }
  h3 {
    font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); margin: 22px 0 8px; font-weight: 600;
  }
  a { color: var(--tool-accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .subtitle { color: var(--secondary); margin: 0 0 18px; }
  .meta {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 6px 24px; margin: 0 0 24px; padding: 14px 16px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  }
  .meta div { display: flex; gap: 8px; align-items: baseline; min-width: 0; }
  .meta dt {
    color: var(--muted); font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.05em; white-space: nowrap;
  }
  .meta dd { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
  .tiles {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px; margin-bottom: 24px;
  }
  .tile {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 13px 15px;
  }
  .tile .label {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted);
  }
  .tile .value { font-size: 24px; font-weight: 600; margin-top: 3px; }
  .tile .sub { font-size: 12px; color: var(--secondary); margin-top: 2px; }
  .sub-inline { font-size: 15px; color: var(--muted); font-weight: 500; }
  .pass { color: var(--good-text); }
  .fail { color: var(--critical-text); }
  table.data {
    width: 100%; border-collapse: collapse; background: var(--surface);
    border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
    font-size: 13px;
  }
  table.data th {
    text-align: left; font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.05em; color: var(--muted); font-weight: 600;
    padding: 8px 12px; border-bottom: 1px solid var(--hairline);
  }
  table.data td {
    padding: 8px 12px; border-bottom: 1px solid var(--hairline);
    vertical-align: top;
  }
  table.data tbody tr:last-child td { border-bottom: none; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .summary { margin-bottom: 8px; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px; padding: 1px 10px;
    border-radius: 999px; font-size: 12px; font-weight: 600;
    border: 1px solid var(--border); white-space: nowrap;
  }
  .chip .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .chip.good { background: var(--good-tint); }
  .chip.good .dot { background: var(--good); }
  .chip.warning { background: var(--warning-tint); }
  .chip.warning .dot { background: var(--warning); }
  .chip.critical { background: var(--critical-tint); }
  .chip.critical .dot { background: var(--critical); }
  .chip.neutral { background: var(--neutral-tint); }
  .chip.neutral .dot { background: var(--muted); }
  .verdict { font-weight: 600; white-space: nowrap; }
  .verdict.pass { color: var(--good-text); }
  .verdict.fail { color: var(--critical-text); }
  .severity {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--muted); font-weight: 600;
  }
  code, pre, .evidence {
    font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
    font-size: 12px;
  }
  code.evidence { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--secondary); }
  .scenario {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 20px 22px; margin-top: 20px;
  }
  .scenario-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .trial-tag {
    font-size: 11px; font-weight: 600; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.05em; margin-left: 10px;
  }
  .top-link { margin-left: auto; font-size: 12px; color: var(--muted); }
  .scenario-title { color: var(--secondary); margin: 4px 0 0; }
  .scenario-meta { color: var(--muted); font-size: 12px; margin: 2px 0 0; }
  .turn {
    border-left: 2px solid var(--hairline); padding-left: 14px; margin: 0 0 18px;
  }
  .turn-label {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--muted); font-weight: 600; margin-bottom: 6px;
  }
  .block { margin: 8px 0; }
  .block-label {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
    font-weight: 600; color: var(--muted); margin-bottom: 3px;
  }
  .block-meta { margin-left: 8px; font-weight: 500; text-transform: none; letter-spacing: 0; }
  .block-body {
    white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .block.user .block-body {
    background: var(--neutral-tint); border-radius: 8px; padding: 8px 12px;
  }
  .block.error .block-body { color: var(--critical-text); }
  .worker-thinking { border-left: 3px solid var(--thinking-accent); padding-left: 12px; }
  .worker-thinking .block-label { color: var(--thinking-accent); }
  .thinking-pre, pre.io {
    margin: 0; white-space: pre-wrap; overflow-wrap: anywhere;
    max-height: 420px; overflow: auto;
  }
  .thinking-pre { color: var(--secondary); }
  details.thinking-details, details.tool, details.attempt {
    border: 1px solid var(--hairline); border-radius: 8px;
    padding: 6px 12px; margin: 8px 0; background: var(--surface);
  }
  details.thinking-details { border-left: 3px solid var(--thinking-accent); }
  details.tool { border-left: 3px solid var(--tool-accent); }
  details summary {
    cursor: pointer; font-size: 13px; color: var(--secondary);
    user-select: none;
  }
  details[open] > summary { margin-bottom: 8px; }
  .tool-tag {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--tool-accent); font-weight: 600; margin-right: 8px;
  }
  .tool-state { margin-left: 10px; font-size: 12px; font-weight: 600; }
  .tool-state.ok { color: var(--good-text); }
  .tool-state.fail { color: var(--critical-text); }
  pre.io {
    background: var(--neutral-tint); border-radius: 6px; padding: 8px 10px;
  }
  .io-label {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--muted); font-weight: 600; margin: 8px 0 3px;
  }
  details.attempt { padding: 8px 14px; }
  details.attempt > summary { font-weight: 600; color: var(--ink); }
  .timeline { border-left: 2px solid var(--hairline); padding-left: 12px; margin-top: 4px; }
  .task { border-top: 1px solid var(--hairline); padding-top: 12px; margin-top: 12px; }
  .task:first-of-type { border-top: none; margin-top: 0; padding-top: 0; }
  .task-head { display: flex; align-items: center; gap: 10px; }
  .task-id { color: var(--muted); }
  .task-desc { color: var(--secondary); margin: 6px 0; }
  .judge-score { margin: 4px 0 12px; font-size: 15px; }
  .judge-score .chip { font-size: 14px; padding: 4px 14px; }
  .note { color: var(--muted); font-size: 13px; }
  footer { margin-top: 32px; color: var(--muted); font-size: 12px; }
`;

/** Renders the full self-contained HTML report for one e2e run. */
export function renderHtmlReport(report: E2eReport): string {
  const model = report.meta.surface.modelId;
  const startedDate = report.meta.startedAt.slice(0, 10);

  const body =
    report.scenarios.length === 0
      ? '<p class="note">No scenario fragments were written — setup likely failed before any scenario ran.</p>'
      : [
          renderOverview(report),
          '<h3>Trials</h3>',
          renderSummaryTable(report.scenarios),
          ...report.scenarios.map(renderScenario),
        ].join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pi-llm e2e &middot; ${esc(model)} &middot; ${esc(startedDate)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap" id="top">
<h1>pi-llm e2e report</h1>
<p class="subtitle">${esc(model)} &middot; ${esc(startedDate)}</p>
${renderMeta(report)}
${body}
<footer>Generated ${esc(new Date().toISOString())} &middot; raw data in report.json</footer>
</div>
</body>
</html>
`;
}
