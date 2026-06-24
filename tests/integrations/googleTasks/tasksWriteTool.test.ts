import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as tasksClient from '../../../src/integrations/googleTasks/tasksClient.js';
import { registerTasksWriteTool } from '../../../src/integrations/googleTasks/tasksWriteTool.js';
import type { IntegrationContext } from '../../../src/integrations/types.js';

type RegisteredTool = {
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }>; details: Record<string, never> }>;
};

/** Captures the registered tasks_write tool execute handler for direct invocation. */
function captureTasksWriteTool(ctx: IntegrationContext): RegisteredTool {
  let registered: RegisteredTool | undefined;

  const pi = {
    registerTool(definition: RegisteredTool & { name: string }) {
      registered = definition;
    },
  } as unknown as ExtensionAPI;

  registerTasksWriteTool(pi, ctx);

  if (registered === undefined) {
    throw new Error('tasks_write was not registered');
  }

  return registered;
}

const sampleTask = {
  listId: 'list-1',
  listTitle: 'My Tasks',
  id: 't1',
  title: 'Buy milk',
  status: 'needsAction',
};

describe('tasks_write tool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('requires title for create', async () => {
    const tool = captureTasksWriteTool({
      userId: 'user-1',
      role: 'worker',
      config: {},
      getAccessToken: vi.fn(() => Promise.resolve('token')),
    });

    const result = await tool.execute('call-1', {
      action: 'create',
      tasklistId: 'list-1',
    });

    expect(result.content[0]?.text).toBe('create requires title.');
  });

  it('creates a task and echoes ids', async () => {
    vi.spyOn(tasksClient, 'findExistingOpenTask').mockResolvedValueOnce(undefined);
    vi.spyOn(tasksClient, 'createTask').mockResolvedValueOnce(sampleTask);

    const tool = captureTasksWriteTool({
      userId: 'user-2',
      role: 'worker',
      config: {},
      getAccessToken: vi.fn(() => Promise.resolve('token')),
    });

    const result = await tool.execute('call-2', {
      action: 'create',
      tasklistId: 'list-1',
      title: 'Buy milk',
    });

    expect(tasksClient.createTask).toHaveBeenCalled();
    expect(result.content[0]?.text).toContain('Task created:');
    expect(result.content[0]?.text).toContain('Reuse task id t1');
  });

  it('reuses an existing open task on idempotent create', async () => {
    vi.spyOn(tasksClient, 'findExistingOpenTask').mockResolvedValueOnce(sampleTask);
    const createSpy = vi.spyOn(tasksClient, 'createTask');

    const tool = captureTasksWriteTool({
      userId: 'user-3',
      role: 'worker',
      config: {},
      getAccessToken: vi.fn(() => Promise.resolve('token')),
    });

    const result = await tool.execute('call-3', {
      action: 'create',
      tasklistId: 'list-1',
      title: 'Buy milk',
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(result.content[0]?.text).toContain('Existing task found');
  });

  it('requires taskId for update', async () => {
    const tool = captureTasksWriteTool({
      userId: 'user-4',
      role: 'worker',
      config: {},
      getAccessToken: vi.fn(() => Promise.resolve('token')),
    });

    const result = await tool.execute('call-4', {
      action: 'update',
      tasklistId: 'list-1',
      status: 'completed',
    });

    expect(result.content[0]?.text).toBe('update requires taskId.');
  });

  it('updates a task with completed status', async () => {
    vi.spyOn(tasksClient, 'updateTask').mockResolvedValueOnce({
      ...sampleTask,
      status: 'completed',
    });

    const tool = captureTasksWriteTool({
      userId: 'user-5',
      role: 'worker',
      config: {},
      getAccessToken: vi.fn(() => Promise.resolve('token')),
    });

    const result = await tool.execute('call-5', {
      action: 'update',
      tasklistId: 'list-1',
      taskId: 't1',
      status: 'completed',
    });

    expect(tasksClient.updateTask).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({ status: 'completed', taskId: 't1', tasklistId: 'list-1' }),
    );
    expect(result.content[0]?.text).toContain('Task updated:');
  });

  it('deletes a task by id', async () => {
    vi.spyOn(tasksClient, 'deleteTask').mockResolvedValueOnce(undefined);

    const tool = captureTasksWriteTool({
      userId: 'user-6',
      role: 'worker',
      config: {},
      getAccessToken: vi.fn(() => Promise.resolve('token')),
    });

    const result = await tool.execute('call-6', {
      action: 'delete',
      tasklistId: 'list-1',
      taskId: 't1',
    });

    expect(tasksClient.deleteTask).toHaveBeenCalledWith('token', 'list-1', 't1');
    expect(result.content[0]?.text).toContain('deleted');
  });
});
