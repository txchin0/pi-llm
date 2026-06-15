import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const EXA_MCP_SERVER = 'https://mcp.exa.ai/mcp';
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024;

const exaMcpClients = new Map<string, Promise<Client>>();

/** Builds the Exa MCP URL, optionally scoped to web search only. */
export function buildExaMcpUrl(apiKey?: string): URL {
  const url = new URL(EXA_MCP_SERVER);
  url.searchParams.set('tools', 'web_search_exa');
  if (apiKey) {
    url.searchParams.set('exaApiKey', apiKey);
  }
  return url;
}

/** Returns a cache key for the resolved Exa API key (`''` when anonymous). */
function apiKeyCacheKey(apiKey?: string): string {
  return apiKey ?? '';
}

/** Returns a shared Exa MCP client keyed by API key, connecting lazily on first use. */
export function getExaMcpClient(apiKey?: string): Promise<Client> {
  const cacheKey = apiKeyCacheKey(apiKey);
  const existing = exaMcpClients.get(cacheKey);
  if (existing) {
    return existing;
  }

  const clientPromise = (async () => {
    const transport = new StreamableHTTPClientTransport(buildExaMcpUrl(apiKey));
    const client = new Client(
      { name: 'pi-llm-surface', version: '0.1.0' },
      { capabilities: {} },
    );
    await client.connect(transport as Parameters<Client['connect']>[0]);
    return client;
  })();

  const trackedPromise = clientPromise.catch((error: unknown) => {
    if (exaMcpClients.get(cacheKey) === trackedPromise) {
      exaMcpClients.delete(cacheKey);
    }
    throw error;
  });

  exaMcpClients.set(cacheKey, trackedPromise);
  return trackedPromise;
}

export type ExaWebSearchOptions = {
  numResults?: number;
  signal?: AbortSignal;
  apiKey?: string;
  maxResponseBytes?: number;
};

/** Calls Exa MCP `web_search_exa` and returns truncated plain text. */
export async function callExaWebSearch(
  query: string,
  options: ExaWebSearchOptions = {},
): Promise<string> {
  const client = await getExaMcpClient(options.apiKey);
  const callOptions = options.signal ? { signal: options.signal } : undefined;
  const result = await client.callTool(
    {
      name: 'web_search_exa',
      arguments: {
        query,
        ...(options.numResults !== undefined
          ? { numResults: options.numResults }
          : {}),
      },
    },
    undefined,
    callOptions,
  );

  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();

  if (result.isError) {
    throw new ExaMcpError(text || 'Exa web search failed', { rateLimited: isRateLimitMessage(text) });
  }

  if (!text) {
    return 'No results';
  }

  return truncateUtf8(text, options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
}

/** Closes all cached Exa MCP clients. */
export async function closeExaMcp(): Promise<void> {
  const clientPromises = [...exaMcpClients.values()];
  exaMcpClients.clear();

  for (const clientPromise of clientPromises) {
    const client = await clientPromise.catch(() => undefined);
    await client?.close();
  }
}

/** Error thrown when Exa MCP search fails. */
export class ExaMcpError extends Error {
  readonly rateLimited: boolean;

  /** Creates an Exa MCP error with optional rate-limit flag. */
  constructor(message: string, options: { rateLimited?: boolean } = {}) {
    super(message);
    this.name = 'ExaMcpError';
    this.rateLimited = options.rateLimited ?? false;
  }
}

/** Truncates text to a UTF-8 byte budget. */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }

  let end = text.length;
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes) {
    end -= 1;
  }

  return `${text.slice(0, end)}\n\n[Response truncated]`;
}

function isRateLimitMessage(message: string): boolean {
  return /\b429\b|rate.?limit/i.test(message);
}

/** Resolves an optional Exa API key from the environment. */
export function resolveExaApiKey(): string | undefined {
  const key = process.env.EXA_API_KEY?.trim();
  return key ? key : undefined;
}

/** @internal Exposes the client cache for tests. */
export function __getExaMcpClientCacheForTests(): Map<string, Promise<Client>> {
  return exaMcpClients;
}
