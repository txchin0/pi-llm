/** Throws when integration tool names collide with base tools or duplicate within the allowlist. */
export function assertToolAllowlistSync(
  baseTools: readonly string[],
  integrationToolNames: readonly string[],
): void {
  const baseSet = new Set(baseTools);
  const seenIntegrationNames = new Set<string>();

  for (const name of integrationToolNames) {
    if (baseSet.has(name)) {
      throw new Error(`Integration tool "${name}" collides with a base tool`);
    }

    if (seenIntegrationNames.has(name)) {
      throw new Error(`Duplicate integration tool name: ${name}`);
    }

    seenIntegrationNames.add(name);
  }
}
