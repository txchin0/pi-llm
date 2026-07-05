import { describe, expect, it } from 'vitest';

import { formatGoogleConnectMessage, formatGoogleConnectError } from '../../../src/integrations/google/oauthConnectMessage.js';
import { OAuthNotConnectedError } from '../../../src/integrations/oauth/oauthService.js';
import { formatGoogleToolError, GoogleNotConnectedError } from '../../../src/integrations/google/toolRuntime.js';

describe('formatGoogleConnectMessage', () => {
  it('points the user at Settings without emitting a raw connect URL', () => {
    const message = formatGoogleConnectMessage('Tasks');
    expect(message).toContain('Google Tasks is not connected');
    expect(message).toContain('Settings');
    // The old static `/start?user_id=` link is dead now that /start requires a
    // minted connect token; it must not leak back into tool output.
    expect(message).not.toContain('/start');
    expect(message).not.toContain('user_id=');
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
      'Calendar',
    );
    expect(message).toContain('Google Calendar is not connected');
  });

  it('returns null for unrelated errors', () => {
    expect(formatGoogleConnectError(new Error('boom'), 'Tasks')).toBeNull();
  });
});

describe('formatGoogleToolError', () => {
  it('formats GoogleNotConnectedError with product label', () => {
    const message = formatGoogleToolError('Tasks', new GoogleNotConnectedError('user-4'));
    expect(message).toContain('Google Tasks is not connected');
  });

  it('formats generic errors with product prefix', () => {
    expect(formatGoogleToolError('Calendar', new Error('api down'))).toBe(
      'Google Calendar failed: api down',
    );
  });
});
