import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

import { registerCalendarReadTool } from '../../../src/integrations/googleCalendar/calendarReadTool.js';
import { OAuthNotConnectedError } from '../../../src/integrations/oauth/oauthService.js';
import type { IntegrationContext } from '../../../src/integrations/types.js';

type RegisteredTool = {
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }>; details: Record<string, never> }>;
};

/** Captures the registered calendar_read tool execute handler for direct invocation. */
function captureCalendarReadTool(ctx: IntegrationContext): RegisteredTool {
  let registered: RegisteredTool | undefined;

  const pi = {
    registerTool(definition: RegisteredTool & { name: string }) {
      registered = definition;
    },
  } as unknown as ExtensionAPI;

  registerCalendarReadTool(pi, ctx);

  if (registered === undefined) {
    throw new Error('calendar_read was not registered');
  }

  return registered;
}

describe('calendar_read tool', () => {
  it('returns connect instructions when getAccessToken is undefined', async () => {
    const tool = captureCalendarReadTool({
      userId: 'user-1',
      role: 'surface',
      config: {},
    });

    const result = await tool.execute('call-1', { mode: 'upcoming' });

    expect(result.content[0]?.text).toContain('/v1/oauth/google/start?user_id=user-1');
    expect(result.content[0]?.text).toContain('not connected');
  });

  it('returns connect instructions when getAccessToken throws OAuthNotConnectedError', async () => {
    const tool = captureCalendarReadTool({
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

    const result = await tool.execute('call-2', { mode: 'upcoming' });

    expect(result.content[0]?.text).toContain('/v1/oauth/google/start?user_id=user-2');
    expect(result.content[0]?.text).not.toContain('OAuth provider');
  });

  it('returns cancelled text when the signal is aborted before execution', async () => {
    const tool = captureCalendarReadTool({
      userId: 'user-3',
      role: 'surface',
      config: {},
      getAccessToken: vi.fn(() => Promise.resolve('token')),
    });

    const controller = new AbortController();
    controller.abort();

    const result = await tool.execute('call-3', { mode: 'upcoming' }, controller.signal);

    expect(result.content[0]?.text).toBe('Request was cancelled');
  });
});
