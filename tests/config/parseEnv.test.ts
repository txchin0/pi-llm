import { describe, expect, it } from 'vitest';

import {
  parseBoolean,
  parseNonEmptyString,
  parsePositiveInt,
} from '../../src/config/parseEnv.js';

describe('parsePositiveInt', () => {
  it('returns the default when unset', () => {
    expect(parsePositiveInt(undefined, 'TEST', 10)).toBe(10);
  });

  it('parses a positive integer', () => {
    expect(parsePositiveInt('42', 'TEST', 10)).toBe(42);
  });

  it('throws for invalid values', () => {
    expect(() => parsePositiveInt('0', 'TEST', 10)).toThrow(/Invalid TEST/);
  });
});

describe('parseBoolean', () => {
  it('returns the default when unset', () => {
    expect(parseBoolean(undefined, false)).toBe(false);
  });

  it('parses true and false flags', () => {
    expect(parseBoolean('true', false)).toBe(true);
    expect(parseBoolean('0', true)).toBe(false);
  });
});

describe('parseNonEmptyString', () => {
  it('returns the default for blank values', () => {
    expect(parseNonEmptyString('   ', 'default')).toBe('default');
  });

  it('returns trimmed non-empty strings', () => {
    expect(parseNonEmptyString('  local  ', 'default')).toBe('local');
  });
});
