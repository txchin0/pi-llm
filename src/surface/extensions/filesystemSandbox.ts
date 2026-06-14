import {
  type ExtensionAPI,
  type ToolCallEvent,
  isToolCallEventType,
} from '@earendil-works/pi-coding-agent';

import { isPathInsideWorkspace } from '../util/isPathInsideWorkspace.js';

const DEFAULT_FILESYSTEM_READ_TOOLS = new Set(['read', 'ls', 'grep', 'find']);

/** Filesystem tools whose paths are validated against the memory workspace. */
export const FILESYSTEM_GUARDED_TOOLS = new Set([
  ...DEFAULT_FILESYSTEM_READ_TOOLS,
  'write',
  'edit',
]);

/** Extracts the filesystem path argument from a Pi filesystem tool call. */
export function extractFilesystemPath(event: ToolCallEvent): string | undefined {
  if (isToolCallEventType('read', event)) {
    return event.input.path;
  }
  if (isToolCallEventType('write', event)) {
    return event.input.path;
  }
  if (isToolCallEventType('edit', event)) {
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

/** Blocks filesystem tool calls that escape the memory workspace. */
export function registerFilesystemSandbox(
  pi: ExtensionAPI,
  guardedTools: ReadonlySet<string> = DEFAULT_FILESYSTEM_READ_TOOLS,
): void {
  pi.on('tool_call', async (event, ctx) => {
    if (!guardedTools.has(event.toolName)) {
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
