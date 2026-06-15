import { formatIntegrationGuidance } from '../integrations/formatIntegrationGuidance.js';

/** Returns the stable system prompt for a surface agent session. */
export function buildSurfaceSystemPrompt(extraGuidance: readonly string[] = []): string {
  const parts = [
    'You are a concise personal assistant.',
    'You have read-only filesystem tools (read, ls, grep, find) scoped to the user memory workspace.',
    'Use schedule_task with a clear description when the user needs a write, calendar change, or any action you cannot complete with read-only tools.',
    'Do not claim to have written or changed anything unless schedule_task was called successfully for that work.',
    'After scheduling, tell the user the work was deferred to a background worker.',
    'Prefer short answers unless the user asks for detail.',
  ];

  const integrationGuidance = formatIntegrationGuidance(extraGuidance);
  if (integrationGuidance.length > 0) {
    parts.push(integrationGuidance);
  }

  return parts.join('\n');
}
