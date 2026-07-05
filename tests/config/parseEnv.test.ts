import { describe, expect, it } from 'vitest';

import {
  parseBoolean,
  parseCsvList,
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

describe('parseCsvList', () => {
  const fallback = ['http://localhost'];

  it('returns the fallback when unset, blank, or all-comma', () => {
    expect(parseCsvList(undefined, fallback)).toEqual(fallback);
    expect(parseCsvList('', fallback)).toEqual(fallback);
    expect(parseCsvList(',', fallback)).toEqual(fallback);
    expect(parseCsvList(' , ', fallback)).toEqual(fallback);
  });

  it('parses comma-separated trimmed values', () => {
    expect(parseCsvList('http://localhost, https://app.example', fallback)).toEqual([
      'http://localhost',
      'https://app.example',
    ]);
    expect(parseCsvList('  http://a  ,  , http://b  ', fallback)).toEqual([
      'http://a',
      'http://b',
    ]);
  });

  it('accepts a single wildcard entry', () => {
    expect(parseCsvList('*', fallback)).toEqual(['*']);
  });
});
