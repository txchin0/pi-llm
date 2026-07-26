import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { TaskRecord } from '../../src/queue/taskTypes.js';
import {
  createWorkerRunTraceSink,
  resolveWorkerTracePath,
} from '../../src/worker/workerRunTrace.js';

function createTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task_test00000001',
    userId: 'web-user',
    description: 'Remember to buy milk',
    context: { turns: [] },
    sessionId: 'sess_test00000001',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    retryCount: 0,
    result: null,
    errorMessage: null,
    completedAt: null,
    ...overrides,
  };
}

describe('resolveWorkerTracePath', () => {
  it('leads with the creation timestamp, then task id and retry attempt', () => {
    const task = createTask({ retryCount: 2 });

    expect(resolveWorkerTracePath('/data', task)).toBe(
      join(
        '/data',
        'users',
        'web-user',
        'worker-traces',
        '2026-01-01T00-00-00-000Z-task_test00000001-attempt-2.jsonl',
      ),
    );
  });

  it('sorts chronologically by filename', () => {
    const earlier = createTask({ createdAt: '2026-01-01T00:00:00.000Z' });
    const later = createTask({ createdAt: '2026-02-01T00:00:00.000Z' });

    expect(
      resolveWorkerTracePath('/data', earlier) <
        resolveWorkerTracePath('/data', later),
    ).toBe(true);
  });
});

describe('createWorkerRunTraceSink', () => {
  it('writes run_start, activity events, and run_end', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'pi-llm-worker-trace-'));
    const task = createTask();
    const trace = createWorkerRunTraceSink({
      dataRoot,
      task,
      startedAt: '2026-01-01T12:00:00.000+11:00',
      now: () => '2026-01-01T12:00:01.000+11:00',
    });

    trace.onEvent({
      type: 'tool_execution_start',
      toolCallId: 'call_1',
      toolName: 'read',
      args: { path: 'notes.md' },
    });
    trace.onEvent({
      type: 'tool_execution_end',
      toolCallId: 'call_1',
      toolName: 'read',
      result: { content: 'ok' },
      isError: false,
    });
    trace.onEvent({
      type: 'message_update',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        api: 'openai-completions',
        provider: 'llamacpp',
        model: 'local',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'done',
        partial: {
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          api: 'openai-completions',
          provider: 'llamacpp',
          model: 'local',
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: Date.now(),
        },
      },
    });

    await trace.close({ kind: 'completed', summaryLength: 4 });

    const tracePath = resolveWorkerTracePath(dataRoot, task);
    const lines = (await readFile(tracePath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string });

    expect(lines[0]).toMatchObject({
      type: 'run_start',
      task_id: task.id,
      user_id: task.userId,
      description: task.description,
      retry_count: 0,
    });
    expect(lines.some((line) => line.type === 'tool_call')).toBe(true);
    expect(lines.some((line) => line.type === 'tool_result')).toBe(true);
    expect(lines.some((line) => line.type === 'text_delta')).toBe(true);
    expect(lines.at(-1)).toMatchObject({
      type: 'run_end',
      kind: 'completed',
      summaryLength: 4,
    });
  });

  it('uses separate files per retry attempt', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'pi-llm-worker-trace-'));
    const firstAttempt = createTask({ retryCount: 0 });
    const secondAttempt = createTask({ retryCount: 1 });

    const firstTrace = createWorkerRunTraceSink({
      dataRoot,
      task: firstAttempt,
      startedAt: '2026-01-01T12:00:00.000+11:00',
    });
    await firstTrace.close({ kind: 'error', message: 'first fail' });

    const secondTrace = createWorkerRunTraceSink({
      dataRoot,
      task: secondAttempt,
      startedAt: '2026-01-01T12:01:00.000+11:00',
    });
    await secondTrace.close({ kind: 'completed', summaryLength: 2 });

    const firstPath = resolveWorkerTracePath(dataRoot, firstAttempt);
    const secondPath = resolveWorkerTracePath(dataRoot, secondAttempt);

    expect(firstPath).not.toBe(secondPath);

    const firstLines = (await readFile(firstPath, 'utf8')).trim().split('\n');
    const secondLines = (await readFile(secondPath, 'utf8')).trim().split('\n');

    expect(JSON.parse(firstLines.at(-1) ?? '{}')).toMatchObject({
      type: 'run_end',
      kind: 'error',
    });
    expect(JSON.parse(secondLines.at(-1) ?? '{}')).toMatchObject({
      type: 'run_end',
      kind: 'completed',
    });
  });

  it('does not throw when close is called after write failures', async () => {
    const trace = createWorkerRunTraceSink({
      dataRoot: '/nonexistent-root/pi-llm-trace',
      task: createTask(),
      startedAt: '2026-01-01T12:00:00.000+11:00',
    });

    trace.onEvent({
      type: 'message_update',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'x' }],
        api: 'openai-completions',
        provider: 'llamacpp',
        model: 'local',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'x',
        partial: {
          role: 'assistant',
          content: [{ type: 'text', text: 'x' }],
          api: 'openai-completions',
          provider: 'llamacpp',
          model: 'local',
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: Date.now(),
        },
      },
    });

    await expect(
      trace.close({ kind: 'aborted' }),
    ).resolves.toBeUndefined();
  });
});
