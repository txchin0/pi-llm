/**
 * Drop-in replacement for `src/integrations/webSearch/exaMcpClient.ts`,
 * installed per scenario file with:
 *
 *   vi.mock('../../../src/integrations/webSearch/exaMcpClient.js', () =>
 *     import('../fakes/fakeExaMcpClient.js'));
 *
 * Returns deterministic canned results containing a distinctive marker fact
 * so scenario checks can verify the assistant grounded its answer in the tool
 * output, and records every call for tool-invocation assertions.
 */

export type FakeExaCall = {
  query: string;
  numResults?: number;
};

export const fakeExaCalls: FakeExaCall[] = [];

/** Clears the recorded web-search calls (called between scenario trials). */
export function resetFakeExaCalls(): void {
  fakeExaCalls.length = 0;
}

/**
 * The marker fact scenario checks assert on: the canned result claims the
 * latest Zig release is this version.
 */
export const FAKE_WEB_SEARCH_ZIG_VERSION = '0.15.2';

const FAKE_RESULT_TEMPLATE = [
  'Search results for: "{{QUERY}}"',
  '',
  'Title: Zig 0.15.2 Release Notes',
  'URL: https://ziglang.org/download/0.15.2/release-notes.html',
  'Published: 2026-03-01',
  'Snippet: The Zig team announced the latest stable release of the Zig',
  `programming language: version ${FAKE_WEB_SEARCH_ZIG_VERSION}, released on 1 March 2026.`,
  'Highlights include faster incremental compilation and improved Windows support.',
].join('\n');

/** Error shape matching the real module (checked via instanceof by its consumer). */
export class ExaMcpError extends Error {
  readonly rateLimited: boolean;

  constructor(message: string, options: { rateLimited?: boolean } = {}) {
    super(message);
    this.name = 'ExaMcpError';
    this.rateLimited = options.rateLimited ?? false;
  }
}

/** Drop-in for `callExaWebSearch`: records the call and returns canned text. */
export function callExaWebSearch(
  query: string,
  options: { numResults?: number } = {},
): Promise<string> {
  fakeExaCalls.push({
    query,
    ...(options.numResults !== undefined ? { numResults: options.numResults } : {}),
  });
  return Promise.resolve(FAKE_RESULT_TEMPLATE.replaceAll('{{QUERY}}', query));
}

/** Drop-in for `resolveExaApiKey`: the fake never needs a key. */
export function resolveExaApiKey(): string | undefined {
  return undefined;
}

/** Drop-in for `closeExaMcp`: nothing to close. */
export async function closeExaMcp(): Promise<void> {
  // No connections in the fake.
}

/** Drop-in for `buildExaMcpUrl` (unused by the faked call path). */
export function buildExaMcpUrl(): URL {
  return new URL('https://mcp.exa.ai/mcp');
}

/** Drop-in for `getExaMcpClient`: e2e scenarios must never reach real Exa. */
export function getExaMcpClient(): Promise<never> {
  return Promise.reject(
    new Error('Real Exa MCP is unavailable in e2e runs; the module is faked'),
  );
}
