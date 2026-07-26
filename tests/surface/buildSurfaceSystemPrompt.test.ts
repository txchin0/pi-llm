import { describe, expect, it } from 'vitest';

import type { SystemPromptInputs } from '../../src/agent/readWorkspaceSnapshot.js';
import type { WorkspaceSnapshot } from '../../src/agent/readWorkspaceSnapshot.js';
import { buildSurfaceSystemPrompt } from '../../src/surface/buildSurfaceSystemPrompt.js';

const emptyWorkspaceSnapshot: WorkspaceSnapshot = {
  indexMarkdown: '',
  conventionsMarkdown: '',
  fileListing: [],
  fieldTruncation: {
    index: false,
    conventions: false,
    fileListing: false,
  },
};

/** Builds SystemPromptInputs for surface prompt tests. */
function systemPromptInputs(
  promptFragments: string[] = [],
  workspace: WorkspaceSnapshot = emptyWorkspaceSnapshot,
): SystemPromptInputs {
  return {
    promptFragments,
    workerCapabilities: [],
    workspace,
  };
}

describe('buildSurfaceSystemPrompt', () => {
  it('appends integration guidance when provided', () => {
    const prompt = buildSurfaceSystemPrompt(
      systemPromptInputs(['Use calendar read tools carefully.']),
    );
    expect(prompt).toContain('Use calendar read tools carefully.');
  });

  it('includes persona, time, memory-first, deferral, and task-status sections', () => {
    const prompt = buildSurfaceSystemPrompt(systemPromptInputs());

    expect(prompt).toContain("You are the user's personal assistant.");
    expect(prompt).toContain('# Time');
    expect(prompt).toContain('[Current time:');
    expect(prompt).toContain('Never mention or repeat the prefix itself.');
    expect(prompt).toContain("Never say you don't know or don't remember until you have");
    expect(prompt).toContain('# Deferred work');
    expect(prompt).toContain('turning relative dates and times like "tomorrow"');
    expect(prompt).toContain('call schedule_task, then let them know');
    expect(prompt).toContain('# Task status');
  });

  it('renders the base capability line then one bullet per worker capability', () => {
    const prompt = buildSurfaceSystemPrompt({
      promptFragments: [],
      workerCapabilities: [
        'Manage Google Calendar: create, update, or delete events.',
        'Manage Google Tasks: create, update, or complete todos.',
      ],
      workspace: emptyWorkspaceSnapshot,
    });

    expect(prompt).toContain(
      '- Remember things: create or edit markdown topic files in the memory workspace',
    );
    expect(prompt).toContain('- Manage Google Calendar: create, update, or delete events.');
    expect(prompt).toContain('- Manage Google Tasks: create, update, or complete todos.');
  });

  it('appends the index truncation marker when the index snapshot is truncated', () => {
    const prompt = buildSurfaceSystemPrompt(
      systemPromptInputs([], {
        ...emptyWorkspaceSnapshot,
        indexMarkdown: '- `profile.md` — user facts',
        fieldTruncation: { ...emptyWorkspaceSnapshot.fieldTruncation, index: true },
      }),
    );

    expect(prompt).toContain('…(index truncated — read index.md for the rest)');
  });

  it('includes index and file listing sections but not conventions', () => {
    const prompt = buildSurfaceSystemPrompt(
      systemPromptInputs([], {
        ...emptyWorkspaceSnapshot,
        indexMarkdown: '- `profile.md` — user facts',
        conventionsMarkdown: '# secret conventions',
        fileListing: ['index.md', 'profile.md'],
      }),
    );

    expect(prompt).toContain('profile.md');
    expect(prompt).toContain('index.md');
    expect(prompt).not.toContain('secret conventions');
    expect(prompt).not.toContain('Memory conventions');
  });

  it('uses empty index fallback when index is missing', () => {
    const prompt = buildSurfaceSystemPrompt(systemPromptInputs());
    expect(prompt).toContain('(memory is currently empty)');
  });
});
