import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __getExaMcpClientCacheForTests,
  buildExaMcpUrl,
  closeExaMcp,
  ExaMcpError,
  getExaMcpClient,
  truncateUtf8,
} from '../../../src/integrations/webSearch/exaMcpClient.js';

const connectMock = vi.fn(() => Promise.resolve(undefined));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function MockClient(this: {
    connect: typeof connectMock;
    close: () => Promise<void>;
  }) {
    this.connect = connectMock;
    this.close = vi.fn(() => Promise.resolve(undefined));
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(function MockTransport(
    this: { url: URL },
    url: URL,
  ) {
    this.url = url;
  }),
}));

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

describe('getExaMcpClient', () => {
  afterEach(async () => {
    connectMock.mockClear();
    await closeExaMcp();
  });

  it('caches clients separately by API key', async () => {
    const anonymous = await getExaMcpClient();
    const withKey = await getExaMcpClient('test-key');

    expect(anonymous).not.toBe(withKey);
    expect(__getExaMcpClientCacheForTests().size).toBe(2);
    expect(connectMock).toHaveBeenCalledTimes(2);

    await getExaMcpClient();
    await getExaMcpClient('test-key');
    expect(connectMock).toHaveBeenCalledTimes(2);
  });
});
