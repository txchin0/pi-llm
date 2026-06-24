import { describe, expect, it } from 'vitest';

import {
  buildDateRangeInTimezone,
  parseDateOnly,
  parseDateTimeInput,
  toRfc3339,
  toTasksApiDueBound,
} from '../../../src/integrations/google/dateBounds.js';

describe('buildDateRangeInTimezone', () => {
  it('returns start and end of day in RFC3339 for a calendar date', () => {
    const range = buildDateRangeInTimezone('2026-06-16', 'Australia/Sydney');

    expect(range.timeMin).toMatch(/^2026-06-1[56]T/);
    expect(range.timeMax).toMatch(/^2026-06-1[67]T/);
    expect(range.timeMin < range.timeMax).toBe(true);
  });
});

describe('parseDateTimeInput', () => {
  it('parses ISO datetimes in the configured timezone', () => {
    const value = parseDateTimeInput('2026-06-16T09:30:00', 'Australia/Sydney');
    expect(value.toFormat('yyyy-LL-dd HH:mm')).toBe('2026-06-16 09:30');
  });
});

describe('toRfc3339', () => {
  it('emits UTC ISO strings suitable for Google API calls', () => {
    const value = toRfc3339(parseDateTimeInput('2026-06-16T09:30:00', 'Australia/Sydney'));
    expect(value.endsWith('Z')).toBe(true);
  });
});

describe('parseDateOnly', () => {
  it('accepts YYYY-MM-DD dates', () => {
    expect(parseDateOnly('2026-06-25')).toBe('2026-06-25');
  });

  it('rejects invalid date strings', () => {
    expect(() => parseDateOnly('not-a-date')).toThrow(/Invalid date/);
  });
});

describe('toTasksApiDueBound', () => {
  it('returns day start and end bounds for Tasks API due filters', () => {
    const start = toTasksApiDueBound('2026-06-25', 'start', 'Australia/Sydney');
    const end = toTasksApiDueBound('2026-06-25', 'end', 'Australia/Sydney');

    expect(start < end).toBe(true);
    expect(start.endsWith('Z')).toBe(true);
    expect(end.endsWith('Z')).toBe(true);
  });
});
