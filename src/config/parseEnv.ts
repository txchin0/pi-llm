/** Parses a positive integer env value or throws. */
export function parsePositiveInt(
  value: string | undefined,
  name: string,
  defaultValue: number,
): number {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }

  return parsed;
}

/** Parses a boolean env flag (`true`/`1`/`false`/`0`). */
export function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  if (value === 'true' || value === '1') {
    return true;
  }

  if (value === 'false' || value === '0') {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}. Expected true or false.`);
}

/** Parses a non-empty trimmed string or returns the default. */
export function parseNonEmptyString(
  value: string | undefined,
  defaultValue: string,
): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : defaultValue;
}
