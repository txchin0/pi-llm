import {
  type ExtensionAPI,
  type ToolCallEvent,
  isToolCallEventType,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import {
  callExaWebSearch,
  closeExaMcp,
  ExaMcpError,
  resolveExaApiKey,
} from '../exaMcpClient.js';
import { isPathInsideWorkspace } from '../util/isPathInsideWorkspace.js';

const FILESYSTEM_READ_TOOLS = new Set(['read', 'ls', 'grep', 'find']);

const webSearchSchema = Type.Object({
  query: Type.String({ description: 'Search query for current web information' }),
  numResults: Type.Optional(
    Type.Number({
      description: 'Maximum number of results to return (default: 5)',
      minimum: 1,
      maximum: 20,
    }),
  ),
});

/** Registers surface tools and enforces memory-workspace path sandboxing. */
export function createSurfaceExtension(pi: ExtensionAPI): void {
  pi.on('tool_call', async (event, ctx) => {
    if (!FILESYSTEM_READ_TOOLS.has(event.toolName)) {
      return undefined;
    }

    const pathArg = extractFilesystemPath(event);
    if (pathArg === undefined) {
      return undefined;
    }

    if (!isPathInsideWorkspace(pathArg, ctx.cwd)) {
      return {
        block: true,
        reason: `Path "${pathArg}" is outside the memory workspace`,
      };
    }

    return undefined;
  });

  pi.registerTool({
    name: 'web_search',
    label: 'web_search',
    description:
      'Search the web for current information, news, documentation, and facts.',
    promptSnippet: 'Search the web for up-to-date information',
    promptGuidelines: [
      'Use web_search for current events, documentation, or facts not stored in memory.',
    ],
    parameters: webSearchSchema,
    async execute(_toolCallId, params, signal) {
      try {
        const searchOptions: {
          numResults?: number;
          signal?: AbortSignal;
          apiKey?: string;
        } = {};
        const apiKey = resolveExaApiKey();
        if (apiKey !== undefined) {
          searchOptions.apiKey = apiKey;
        }
        if (params.numResults !== undefined) {
          searchOptions.numResults = params.numResults;
        }
        if (signal !== undefined) {
          searchOptions.signal = signal;
        }

        const text = await callExaWebSearch(params.query, searchOptions);
        return {
          content: [{ type: 'text' as const, text }],
          details: {},
        };
      } catch (error) {
        if (signal?.aborted) {
          return {
            content: [{ type: 'text' as const, text: 'Request was cancelled' }],
            details: {},
          };
        }

        const message = formatWebSearchError(error);
        return {
          content: [{ type: 'text' as const, text: message }],
          details: {},
        };
      }
    },
  });

  pi.on('session_shutdown', async () => {
    await closeExaMcp();
  });
}

function extractFilesystemPath(event: ToolCallEvent): string | undefined {
  if (isToolCallEventType('read', event)) {
    return event.input.path;
  }
  if (isToolCallEventType('ls', event)) {
    return event.input.path ?? '.';
  }
  if (isToolCallEventType('grep', event)) {
    return event.input.path ?? '.';
  }
  if (isToolCallEventType('find', event)) {
    return event.input.path ?? '.';
  }
  return undefined;
}

function formatWebSearchError(error: unknown): string {
  if (error instanceof ExaMcpError) {
    if (error.rateLimited) {
      return `${error.message}\n\nOptional: set EXA_API_KEY for higher rate limits.`;
    }
    return error.message;
  }

  if (error instanceof Error) {
    if (isRateLimitError(error)) {
      return `${error.message}\n\nOptional: set EXA_API_KEY for higher rate limits.`;
    }
    return `Web search failed: ${error.message}`;
  }

  return 'Web search failed';
}

function isRateLimitError(error: Error): boolean {
  return /\b429\b|rate.?limit/i.test(error.message);
}
