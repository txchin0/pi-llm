import { describe, expect, it } from 'vitest';

import {
  buildExaMcpUrl,
  ExaMcpError,
  truncateUtf8,
} from '../../src/surface/exaMcpClient.js';

describe('buildExaMcpUrl', () => {
  it('scopes the MCP server to web search only', () => {
    const url = buildExaMcpUrl();
    expect(url.origin + url.pathname).toBe('https://mcp.exa.ai/mcp');
    expect(url.searchParams.get('tools')).toBe('web_search_exa');
    expect(url.searchParams.has('exaApiKey')).toBe(false);
  });

  it('adds an API key when provided', () => {
    const url = buildExaMcpUrl('test-key');
    expect(url.searchParams.get('exaApiKey')).toBe('test-key');
  });
});

describe('truncateUtf8', () => {
  it('returns the original text when under the byte limit', () => {
    expect(truncateUtf8('hello', 32)).toBe('hello');
  });

  it('truncates text that exceeds the byte limit', () => {
    const text = 'x'.repeat(200);
    const truncated = truncateUtf8(text, 32);
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(32 + 64);
    expect(truncated).toContain('[Response truncated]');
  });
});

describe('ExaMcpError', () => {
  it('marks rate-limit failures', () => {
    const error = new ExaMcpError('HTTP 429', { rateLimited: true });
    expect(error.rateLimited).toBe(true);
    expect(error.message).toBe('HTTP 429');
  });
});
