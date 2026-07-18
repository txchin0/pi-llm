import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { TaskRecord } from '../../../src/queue/taskTypes.js';

import { capPayload } from './report.js';

/**
 * Chronological worker-attempt timeline entry parsed from a trace JSONL file.
 * Consecutive `thinking_delta` / `text_delta` records are merged into single
 * blocks so the report shows readable prose instead of token fragments.
 */
export type WorkerTimelineEntry =
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; step: number; toolName: string; input: unknown }
  | {
      kind: 'tool_result';
      step: number;
      toolName: string;
      output: unknown;
      isError: boolean;
    }
  | { kind: 'error'; message: string };

/** One worker attempt (one trace file) in report-friendly form. */
export type WorkerAttemptTrace = {
  attempt: number;
  timeline: WorkerTimelineEntry[];
  usage: { inputTokens: number; outputTokens: number };
  /** `completed`, `error: <message>`, `aborted`, `timeout`, or `unknown`. */
  outcome: string;
  durationMs: number | null;
};

type TraceRecord = { type?: unknown; at?: unknown } & Record<string, unknown>;

/**
 * Reads every trace attempt the worker wrote for one task, oldest attempt
 * first. Returns an empty array when the task never reached the worker (or
 * the trace directory is gone).
 */
export async function readWorkerAttemptTraces(
  dataRoot: string,
  task: TaskRecord,
): Promise<WorkerAttemptTrace[]> {
  const traceDir = join(dataRoot, 'users', task.userId, 'worker-traces');

  let entries: string[];
  try {
    entries = await readdir(traceDir);
  } catch {
    return [];
  }

  const prefix = `${task.id}-attempt-`;
  const attempts: WorkerAttemptTrace[] = [];

  for (const name of entries) {
    if (!name.startsWith(prefix) || !name.endsWith('.jsonl')) {
      continue;
    }

    const attempt = Number(name.slice(prefix.length, -'.jsonl'.length));
    if (!Number.isInteger(attempt) || attempt < 0) {
      continue;
    }

    const raw = await readFile(join(traceDir, name), 'utf8');
    attempts.push(parseWorkerTrace(raw, attempt));
  }

  return attempts.sort((a, b) => a.attempt - b.attempt);
}

/** Parses one trace JSONL payload into a timeline; invalid lines are skipped. */
export function parseWorkerTrace(jsonl: string, attempt: number): WorkerAttemptTrace {
  const timeline: WorkerTimelineEntry[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let outcome = 'unknown';
  let firstAt: number | null = null;
  let lastAt: number | null = null;

  const appendProse = (kind: 'thinking' | 'text', text: string): void => {
    const last = timeline.at(-1);
    if (last !== undefined && last.kind === kind) {
      last.text += text;
      return;
    }

    timeline.push({ kind, text });
  };

  for (const line of jsonl.split(/\r?\n/)) {
    if (line.trim() === '') {
      continue;
    }

    let record: TraceRecord;
    try {
      record = JSON.parse(line) as TraceRecord;
    } catch {
      continue;
    }

    if (typeof record.at === 'string') {
      const time = Date.parse(record.at);
      if (!Number.isNaN(time)) {
        firstAt = firstAt ?? time;
        lastAt = time;
      }
    }

    switch (record.type) {
      case 'thinking_delta':
        appendProse('thinking', typeof record.text === 'string' ? record.text : '');
        break;
      case 'text_delta':
        appendProse('text', typeof record.text === 'string' ? record.text : '');
        break;
      case 'tool_call':
        timeline.push({
          kind: 'tool_call',
          step: typeof record.step === 'number' ? record.step : 0,
          toolName:
            typeof record.tool_name === 'string' ? record.tool_name : 'unknown',
          input: capPayload(record.input),
        });
        break;
      case 'tool_result':
        timeline.push({
          kind: 'tool_result',
          step: typeof record.step === 'number' ? record.step : 0,
          toolName:
            typeof record.tool_name === 'string' ? record.tool_name : 'unknown',
          output: capPayload(record.output),
          isError: record.is_error === true,
        });
        break;
      case 'usage': {
        const tokens = record.usage as
          | { input_tokens?: unknown; output_tokens?: unknown }
          | undefined;
        if (typeof tokens?.input_tokens === 'number') {
          usage.inputTokens += tokens.input_tokens;
        }
        if (typeof tokens?.output_tokens === 'number') {
          usage.outputTokens += tokens.output_tokens;
        }
        break;
      }
      case 'agent_error':
        timeline.push({
          kind: 'error',
          message:
            typeof record.message === 'string' ? record.message : 'unknown error',
        });
        break;
      case 'run_end': {
        const kind = typeof record.kind === 'string' ? record.kind : 'unknown';
        outcome =
          kind === 'error' && typeof record.message === 'string'
            ? `error: ${record.message}`
            : kind;
        break;
      }
      default:
        // run_start / agent_finished only contribute timestamps.
        break;
    }
  }

  return {
    attempt,
    timeline,
    usage,
    outcome,
    durationMs: firstAt !== null && lastAt !== null ? lastAt - firstAt : null,
  };
}
