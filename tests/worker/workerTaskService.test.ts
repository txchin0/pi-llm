import { describe, expect, it, vi } from 'vitest';

import { unconfiguredOAuthService } from '../../src/integrations/oauth/unconfiguredOAuthService.js';
import type { TaskRecord } from '../../src/queue/taskTypes.js';
import { buildWorkerTaskPrompt } from '../../src/worker/buildWorkerTaskPrompt.js';
import {
  createWorkerTaskService,
  type WorkerPromptRunner,
  type WorkerSessionFactory,
  type WorkerTraceFactory,
} from '../../src/worker/workerTaskService.js';
import type { WorkerRunTraceSink } from '../../src/worker/workerRunTrace.js';
import { createEmptyIntegrationStore } from '../helpers/emptyIntegrationStore.js';

describe('createWorkerTaskService', () => {
  it('builds a prompt with description, context turns, and current time', async () => {
    const task: TaskRecord = {
      id: 'task_test00000001',
      userId: 'web-user',
      description: 'Remember to buy milk',
      context: {
        turns: [
          { role: 'user', content: 'Remind me to buy milk' },
          { role: 'assistant', content: 'I will schedule that.' },
        ],
      },
      sessionId: 'sess_test00000001',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      retryCount: 0,
      result: null,
      errorMessage: null,
      completedAt: null,
    };

    const createSession = vi
      .fn()
      .mockResolvedValue({ prompt: vi.fn() }) as WorkerSessionFactory;
    const runPrompt = vi.fn().mockResolvedValue('Reminder saved.') as WorkerPromptRunner;

    const service = createWorkerTaskService({
      dataRoot: './data',
      authStorage: {} as never,
      modelRegistry: {} as never,
      model: {} as never,
      agentConfig: {} as never,
      integrationStore: createEmptyIntegrationStore(),
      oauthService: unconfiguredOAuthService,
      now: () => '2026-01-01T12:00:00.000+11:00',
      createSession,
      runPrompt,
    });

    const result = await service.runTask(task, new AbortController().signal);

    expect(result).toBe('Reminder saved.');
    expect(createSession).toHaveBeenCalledOnce();
    expect(runPrompt).toHaveBeenCalledOnce();

    const prompt = vi.mocked(runPrompt).mock.calls[0]?.[1];
    expect(prompt).toContain('[Current time: 2026-01-01T12:00:00.000+11:00]');
    expect(prompt).toContain('Task: Remember to buy milk');
    expect(prompt).toContain('user: Remind me to buy milk');
    expect(prompt).toContain('assistant: I will schedule that.');
  });

  it('propagates agent errors from the runner', async () => {
    const task: TaskRecord = {
      id: 'task_test00000002',
      userId: 'web-user',
      description: 'fail task',
      context: { turns: [] },
      sessionId: null,
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      retryCount: 0,
      result: null,
      errorMessage: null,
      completedAt: null,
    };

    const service = createWorkerTaskService({
      dataRoot: './data',
      authStorage: {} as never,
      modelRegistry: {} as never,
      model: {} as never,
      agentConfig: {} as never,
      integrationStore: createEmptyIntegrationStore(),
      oauthService: unconfiguredOAuthService,
      createSession: vi
        .fn()
        .mockResolvedValue({ prompt: vi.fn() }) as WorkerSessionFactory,
      runPrompt: vi
        .fn()
        .mockRejectedValue(new Error('agent down')) as WorkerPromptRunner,
    });

    await expect(
      service.runTask(task, new AbortController().signal),
    ).rejects.toThrow('agent down');
  });

  it('closes the trace sink in finally on success and failure', async () => {
    const task: TaskRecord = {
      id: 'task_test00000004',
      userId: 'web-user',
      description: 'trace task',
      context: { turns: [] },
      sessionId: null,
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      retryCount: 0,
      result: null,
      errorMessage: null,
      completedAt: null,
    };

    const outcomes: Array<{ kind: string }> = [];
    const createTrace = vi.fn(
      (): WorkerRunTraceSink => ({
        onEvent() {},
        close: (outcome) => {
          outcomes.push(outcome);
          return Promise.resolve();
        },
      }),
    ) as WorkerTraceFactory;

    const service = createWorkerTaskService({
      dataRoot: './data',
      authStorage: {} as never,
      modelRegistry: {} as never,
      model: {} as never,
      agentConfig: {} as never,
      integrationStore: createEmptyIntegrationStore(),
      oauthService: unconfiguredOAuthService,
      now: () => '2026-01-01T12:00:00.000+11:00',
      createSession: vi
        .fn()
        .mockResolvedValue({ prompt: vi.fn() }) as WorkerSessionFactory,
      createTrace,
      runPrompt: vi.fn().mockResolvedValue('done') as WorkerPromptRunner,
    });

    await service.runTask(task, new AbortController().signal);

    expect(createTrace).toHaveBeenCalledWith(
      task,
      '2026-01-01T12:00:00.000+11:00',
    );
    expect(outcomes).toEqual([{ kind: 'completed', summaryLength: 4 }]);

    const failingService = createWorkerTaskService({
      dataRoot: './data',
      authStorage: {} as never,
      modelRegistry: {} as never,
      model: {} as never,
      agentConfig: {} as never,
      integrationStore: createEmptyIntegrationStore(),
      oauthService: unconfiguredOAuthService,
      now: () => '2026-01-01T12:00:00.000+11:00',
      createSession: vi
        .fn()
        .mockResolvedValue({ prompt: vi.fn() }) as WorkerSessionFactory,
      createTrace,
      runPrompt: vi
        .fn()
        .mockRejectedValue(new Error('boom')) as WorkerPromptRunner,
    });

    outcomes.length = 0;

    await expect(
      failingService.runTask(task, new AbortController().signal),
    ).rejects.toThrow('boom');
    expect(outcomes).toEqual([{ kind: 'error', message: 'boom' }]);
  });
});

describe('buildWorkerTaskPrompt', () => {
  it('omits the conversation section when there are no turns', () => {
    const prompt = buildWorkerTaskPrompt(
      {
        id: 'task_test00000003',
        userId: 'web-user',
        description: 'solo task',
        context: { turns: [] },
        sessionId: null,
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        retryCount: 0,
        result: null,
        errorMessage: null,
        completedAt: null,
      },
      '2026-01-01T12:00:00.000+11:00',
    );

    expect(prompt).toContain('Task: solo task');
    expect(prompt).not.toContain('Recent conversation:');
  });
});
