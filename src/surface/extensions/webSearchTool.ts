import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import {
  callExaWebSearch,
  ExaMcpError,
  resolveExaApiKey,
} from '../exaMcpClient.js';

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

/** Registers the surface `web_search` custom tool. */
export function registerWebSearchTool(pi: ExtensionAPI): void {
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
