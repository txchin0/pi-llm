import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

import * as tasksClient from '../../../src/integrations/googleTasks/tasksClient.js';
import { registerTasksReadTool } from '../../../src/integrations/googleTasks/tasksReadTool.js';
import { OAuthNotConnectedError } from '../../../src/integrations/oauth/oauthService.js';
import type { IntegrationContext } from '../../../src/integrations/types.js';

type RegisteredTool = {
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }>; details: Record<string, never> }>;
};

/** Captures the registered tasks_read tool execute handler for direct invocation. */
function captureTasksReadTool(ctx: IntegrationContext): RegisteredTool {
  let registered: RegisteredTool | undefined;

  const pi = {
    registerTool(definition: RegisteredTool & { name: string }) {
      registered = definition;
    },
  } as unknown as ExtensionAPI;

  registerTasksReadTool(pi, ctx);

  if (registered === undefined) {
    throw new Error('tasks_read was not registered');
  }

  return registered;
}

describe('tasks_read tool', () => {
  it('returns connect instructions when getAccessToken is undefined', async () => {
    const tool = captureTasksReadTool({
      userId: 'user-1',
      role: 'surface',
      config: {},
    });

    const result = await tool.execute('call-1', {});

    expect(result.content[0]?.text).toContain('Google Tasks is not connected');
    expect(result.content[0]?.text).toContain('Settings');
  });

  it('returns connect instructions when getAccessToken throws OAuthNotConnectedError', async () => {
    const tool = captureTasksReadTool({
      userId: 'user-2',
      role: 'surface',
      config: {},
      getAccessToken: () =>
        Promise.reject(
          new OAuthNotConnectedError({
            providerId: 'google',
            userId: 'user-2',
            reason: 'not_connected',
          }),
        ),
    });

    const result = await tool.execute('call-2', {});

    expect(result.content[0]?.text).toContain('Google Tasks is not connected');
    expect(result.content[0]?.text).toContain('Settings');
  });

  it('lists task lists when listTaskLists is true', async () => {
    const listSpy = vi.spyOn(tasksClient, 'listTaskLists').mockResolvedValue([
      { id: 'list-1', title: 'My Tasks' },
    ]);

    const tool = captureTasksReadTool({
      userId: 'user-3',
      role: 'surface',
      config: {},
      getAccessToken: vi.fn(() => Promise.resolve('token')),
    });

    const result = await tool.execute('call-3', { listTaskLists: true });

    expect(result.content[0]?.text).toContain('Task lists:');
    expect(result.content[0]?.text).toContain('list id: list-1');
    listSpy.mockRestore();
  });

  it('returns validation error for partial due range', async () => {
    const tool = captureTasksReadTool({
      userId: 'user-4',
      role: 'surface',
      config: {},
      getAccessToken: vi.fn(() => Promise.resolve('token')),
    });

    const result = await tool.execute('call-4', { dueMin: '2026-06-20' });

    expect(result.content[0]?.text).toContain('dueMin and dueMax');
  });

  it('returns cancelled text when the signal is aborted before execution', async () => {
    const tool = captureTasksReadTool({
      userId: 'user-5',
      role: 'surface',
      config: {},
      getAccessToken: vi.fn(() => Promise.resolve('token')),
    });

    const controller = new AbortController();
    controller.abort();

    const result = await tool.execute('call-5', {}, controller.signal);

    expect(result.content[0]?.text).toBe('Request was cancelled');
  });
});
