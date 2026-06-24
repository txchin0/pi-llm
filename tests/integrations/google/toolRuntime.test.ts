import { describe, expect, it } from 'vitest';

import { formatGoogleConnectMessage, formatGoogleConnectError } from '../../../src/integrations/google/oauthConnectMessage.js';
import { OAuthNotConnectedError } from '../../../src/integrations/oauth/oauthService.js';
import { formatGoogleToolError, GoogleNotConnectedError } from '../../../src/integrations/google/toolRuntime.js';

describe('formatGoogleConnectMessage', () => {
  it('includes product label and connect URL', () => {
    const message = formatGoogleConnectMessage('user-1', 'Tasks');
    expect(message).toContain('Google Tasks is not connected');
    expect(message).toContain('/v1/oauth/google/start?user_id=user-1');
  });
});

describe('formatGoogleConnectError', () => {
  it('maps OAuthNotConnectedError to connect instructions', () => {
    const message = formatGoogleConnectError(
      new OAuthNotConnectedError({
        providerId: 'google',
        userId: 'user-2',
        reason: 'not_connected',
      }),
      'user-2',
      'Calendar',
    );
    expect(message).toContain('Google Calendar is not connected');
  });

  it('returns null for unrelated errors', () => {
    expect(formatGoogleConnectError(new Error('boom'), 'user-3', 'Tasks')).toBeNull();
  });
});

describe('formatGoogleToolError', () => {
  it('formats GoogleNotConnectedError with product label', () => {
    const message = formatGoogleToolError('Tasks', new GoogleNotConnectedError('user-4'), 'user-4');
    expect(message).toContain('Google Tasks is not connected');
  });

  it('formats generic errors with product prefix', () => {
    expect(formatGoogleToolError('Calendar', new Error('api down'), 'user-5')).toBe(
      'Google Calendar failed: api down',
    );
  });
});
