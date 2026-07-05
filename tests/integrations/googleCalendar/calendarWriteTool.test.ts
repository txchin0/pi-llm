import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';

import { registerCalendarWriteTool } from '../../../src/integrations/googleCalendar/calendarWriteTool.js';
import { OAuthNotConnectedError } from '../../../src/integrations/oauth/oauthService.js';
import type { IntegrationContext } from '../../../src/integrations/types.js';

type RegisteredTool = {
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }>; details: Record<string, never> }>;
};

/** Captures the registered calendar_write tool execute handler for direct invocation. */
function captureCalendarWriteTool(ctx: IntegrationContext): RegisteredTool {
  let registered: RegisteredTool | undefined;

  const pi = {
    registerTool(definition: RegisteredTool & { name: string }) {
      registered = definition;
    },
  } as unknown as ExtensionAPI;

  registerCalendarWriteTool(pi, ctx);

  if (registered === undefined) {
    throw new Error('calendar_write was not registered');
  }

  return registered;
}

describe('calendar_write tool', () => {
  it('returns connect instructions when getAccessToken is undefined', async () => {
    const tool = captureCalendarWriteTool({
      userId: 'user-1',
      role: 'worker',
      config: {},
    });

    const result = await tool.execute('call-1', { action: 'delete', eventId: 'evt-1' });

    expect(result.content[0]?.text).toContain('not connected');
    expect(result.content[0]?.text).toContain('Settings');
  });

  it('returns connect instructions when getAccessToken throws OAuthNotConnectedError', async () => {
    const tool = captureCalendarWriteTool({
      userId: 'user-2',
      role: 'worker',
      config: {},
      getAccessToken: () =>
        Promise.reject(
          new OAuthNotConnectedError({
            providerId: 'google',
            userId: 'user-2',
            reason: 'missing_scopes',
            missingScopes: ['https://www.googleapis.com/auth/calendar.events'],
          }),
        ),
    });

    const result = await tool.execute('call-2', {
      action: 'create',
      summary: 'Test',
      start: '2026-06-16T10:00:00',
      end: '2026-06-16T11:00:00',
    });

    expect(result.content[0]?.text).toContain('not connected');
    expect(result.content[0]?.text).not.toContain('missing scopes');
  });
});
