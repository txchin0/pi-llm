import type { IntegrationContext } from '../types.js';
import type { GoogleProductLabel } from './oauthConnectMessage.js';
import { formatGoogleConnectError, formatGoogleConnectMessage } from './oauthConnectMessage.js';

/** Thrown when a Google integration tool has no OAuth token binding. */
export class GoogleNotConnectedError extends Error {
  readonly userId: string;

  /** Marks a missing OAuth binding as a not-connected state for friendly tool output. */
  constructor(userId: string) {
    super('OAuth not connected');
    this.name = 'GoogleNotConnectedError';
    this.userId = userId;
  }
}

/** Resolves an OAuth access token or throws when the integration is not connected. */
export async function resolveGoogleAccessToken(ctx: IntegrationContext): Promise<string> {
  if (ctx.getAccessToken === undefined) {
    throw new GoogleNotConnectedError(ctx.userId);
  }
  return ctx.getAccessToken();
}

/** Standard text tool result shape for Pi integration tools. */
export function textToolResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    details: {},
  };
}

/** Result returned when a tool call is aborted before completion. */
export function cancelledToolResult() {
  return textToolResult('Request was cancelled');
}

/** Maps tool errors to user-facing text for a Google product integration. */
export function formatGoogleToolError(
  product: GoogleProductLabel,
  error: unknown,
  userId: string,
): string {
  if (error instanceof GoogleNotConnectedError) {
    return formatGoogleConnectMessage(userId, product);
  }

  const oauthMessage = formatGoogleConnectError(error, userId, product);
  if (oauthMessage !== null) {
    return oauthMessage;
  }

  if (error instanceof Error) {
    return `Google ${product} failed: ${error.message}`;
  }

  return `Google ${product} failed`;
}
