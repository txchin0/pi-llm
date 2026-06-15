/** Formats integration-level system-prompt fragments for appending to a role prompt. */
export function formatIntegrationGuidance(fragments: readonly string[]): string {
  const trimmed = fragments.map((fragment) => fragment.trim()).filter((fragment) => fragment.length > 0);
  if (trimmed.length === 0) {
    return '';
  }

  return trimmed.join('\n\n');
}
