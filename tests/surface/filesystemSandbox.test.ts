import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ExtensionAPI, ToolCallEvent } from '@earendil-works/pi-coding-agent';

import {
  extractFilesystemPath,
  FILESYSTEM_GUARDED_TOOLS,
  registerFilesystemSandbox,
} from '../../src/surface/extensions/filesystemSandbox.js';

type ToolCallHandler = (
  event: ToolCallEvent,
  ctx: { cwd: string },
) => Promise<{ block: true; reason: string } | undefined>;

/** Invokes the registered filesystem sandbox handler for one tool call. */
async function runSandboxCheck(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  guardedTools?: ReadonlySet<string>,
): Promise<{ block: true; reason: string } | undefined> {
  let handler: ToolCallHandler | undefined;

  const pi = {
    on(eventName: string, fn: ToolCallHandler) {
      if (eventName === 'tool_call') {
        handler = fn;
      }
    },
  } as ExtensionAPI;

  registerFilesystemSandbox(pi, guardedTools);

  const event = {
    toolName,
    input,
  } as ToolCallEvent;

  return handler?.(event, { cwd });
}

describe('registerFilesystemSandbox', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'pi-llm-sandbox-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('blocks write paths outside the workspace', async () => {
    const outsidePath = join(tmpdir(), 'pi-llm-outside-passwd');
    const result = await runSandboxCheck(
      'write',
      { path: outsidePath, content: 'nope' },
      workspace,
      FILESYSTEM_GUARDED_TOOLS,
    );

    expect(result).toEqual({
      block: true,
      reason: `Path "${outsidePath}" is outside the memory workspace`,
    });
  });

  it('blocks edit paths outside the workspace', async () => {
    const result = await runSandboxCheck(
      'edit',
      { path: '../outside.md', oldText: 'a', newText: 'b' },
      workspace,
      FILESYSTEM_GUARDED_TOOLS,
    );

    expect(result).toEqual({
      block: true,
      reason: 'Path "../outside.md" is outside the memory workspace',
    });
  });

  it('allows write paths inside the workspace', async () => {
    const result = await runSandboxCheck(
      'write',
      { path: 'topics/notes.md', content: 'hello' },
      workspace,
      FILESYSTEM_GUARDED_TOOLS,
    );

    expect(result).toBeUndefined();
  });

  it('extracts write and edit paths', () => {
    expect(
      extractFilesystemPath({
        toolName: 'write',
        input: { path: 'a.md', content: 'x' },
      } as ToolCallEvent),
    ).toBe('a.md');

    expect(
      extractFilesystemPath({
        toolName: 'edit',
        input: { path: 'b.md', oldText: 'a', newText: 'b' },
      } as unknown as ToolCallEvent),
    ).toBe('b.md');
  });
});
