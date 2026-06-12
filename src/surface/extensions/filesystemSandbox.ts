import {
  type ExtensionAPI,
  type ToolCallEvent,
  isToolCallEventType,
} from '@earendil-works/pi-coding-agent';

import { isPathInsideWorkspace } from '../util/isPathInsideWorkspace.js';

const FILESYSTEM_READ_TOOLS = new Set(['read', 'ls', 'grep', 'find']);

/** Extracts the filesystem path argument from a Pi read-only tool call. */
export function extractFilesystemPath(event: ToolCallEvent): string | undefined {
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

/** Blocks read-only filesystem tool calls that escape the memory workspace. */
export function registerFilesystemSandbox(pi: ExtensionAPI): void {
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
}
